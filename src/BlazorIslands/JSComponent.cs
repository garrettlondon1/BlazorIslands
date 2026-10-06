// Licensed under the MIT license.

using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.JSInterop;

namespace BlazorIslands;

/// <summary>
/// A Razor component with a JavaScript half: one JS instance per component, created from a collocated
/// <c>.razor.js</c> module, receiving the component's parameters, finding its elements, and calling (and being called by)
/// .NET. It works the same under static SSR, enhanced navigation, streaming and every interactive render mode, and keeps
/// its JS instance (no second mount) when an interactive renderer takes over a prerendered page.
/// </summary>
/// <example>
/// <code>
/// @inherits JSComponent
/// &lt;JSScope For="this"&gt;
///     &lt;canvas data-ref="canvas"&gt;&lt;/canvas&gt;
///     &lt;button @onclick="() =&gt; InvokeJSVoidAsync(&quot;highlight&quot;, 2)"&gt;Highlight&lt;/button&gt;
/// &lt;/JSScope&gt;
/// @code {
///     [Parameter] public double[] Values { get; set; } = [];
///     [JSInvokable] public void BarClicked(int index) =&gt; ...;
/// }
/// </code>
/// <code>
/// // Chart.razor.js
/// export default class Chart {
///   constructor(ctx) { this.ctx = ctx; this.draw(ctx.props.values); }
///   update(params) { this.draw(params.values); }     // parameters changed
///   rendered() { }                                   // Blazor changed the markup
///   highlight(i) { }                                 // called from C#
///   draw(values) { const canvas = this.ctx.ref('canvas'); ... this.ctx.invokeDotNet('BarClicked', 0); }
///   unmount() { }
/// }
/// </code>
/// </example>
public abstract class JSComponent : ComponentBase
{
    private static readonly Dictionary<Type, PropertyInfo[]> JsonParameters = [];

    internal JSScope? Scope { get; set; }

    internal string ModuleForScope => JSModule;

    internal object? ParametersForScope => JSParameters;

    /// <summary>True when this component has an interactive render mode, even while it is being prerendered.</summary>
    internal bool HasInteractiveRenderMode => AssignedRenderMode is not null || RendererInfo.IsInteractive;

    /// <summary>
    /// The JS module, relative to the app base. Defaults to the collocated <c>.razor.js</c> file, found in the app's
    /// static asset manifest: <c>Components/Pages/Chart.razor.js</c> for <c>MyApp.Components.Pages.Chart</c>, or
    /// <c>_content/MyLib/Charts/Chart.razor.js</c> when the component ships in a Razor class library.
    /// </summary>
    protected virtual string JSModule => JSModulePaths.Collocated(GetType());

    /// <summary>
    /// What the JS instance receives as <c>ctx.props</c> and in <c>update(params)</c>. Defaults to every
    /// <c>[Parameter]</c> that can be serialized (render fragments, callbacks and delegates are skipped), in camelCase.
    /// </summary>
    protected virtual object? JSParameters
    {
        get
        {
            var values = new JSParameterValues();
            foreach (var property in ParametersOf(GetType()))
            {
                values[property.Name] = property.GetValue(this);
            }

            return values;
        }
    }

    /// <summary>
    /// Calls a method on this component's JS instance (a class method, or a function exported by the module).
    /// Interactive render modes only. Arguments may include <see cref="ElementReference"/>s, which arrive as DOM elements.
    /// </summary>
    protected ValueTask<TValue> InvokeJSAsync<TValue>(string method, params object?[] args)
        => RequireScope(method).InvokeAsync<TValue>(method, args);

    /// <inheritdoc cref="InvokeJSAsync{TValue}(string, object?[])"/>
    protected async ValueTask InvokeJSVoidAsync(string method, params object?[] args)
        => await RequireScope(method).InvokeAsync<JsonElement>(method, args);

    private JSScope RequireScope(string method)
    {
        if (Scope is null)
        {
            throw new InvalidOperationException($"{GetType().Name} has no <JSScope For=\"this\"> in its markup, so there is no JS instance to call '{method}' on.");
        }

        if (!RendererInfo.IsInteractive)
        {
            throw new InvalidOperationException($"Cannot call JS method '{method}' on {GetType().Name}: it is statically rendered. Give it an interactive render mode.");
        }

        return Scope;
    }

    [UnconditionalSuppressMessage("Trimming", "IL2070", Justification = "Parameters of rendered components are preserved by the Razor compiler.")]
    private static PropertyInfo[] ParametersOf(Type type)
    {
        lock (JsonParameters)
        {
            if (!JsonParameters.TryGetValue(type, out var properties))
            {
                properties = type
                    .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                    .Where(p => p.GetCustomAttribute<ParameterAttribute>() is { CaptureUnmatchedValues: false } && p.CanRead && IsSerializable(p.PropertyType))
                    .OrderBy(p => p.MetadataToken)
                    .ToArray();
                JsonParameters[type] = properties;
            }

            return properties;
        }
    }

    private static bool IsSerializable(Type type)
        => !typeof(Delegate).IsAssignableFrom(type)
           && type != typeof(RenderFragment)
           && !(type.IsGenericType && type.GetGenericTypeDefinition() == typeof(RenderFragment<>))
           && type != typeof(EventCallback)
           && !(type.IsGenericType && type.GetGenericTypeDefinition() == typeof(EventCallback<>))
           && type != typeof(ElementReference)
           && !typeof(IJSObjectReference).IsAssignableFrom(type);
}

/// <summary>
/// Marks the markup a <see cref="JSComponent"/>'s JS instance attaches to. Renders a <c>&lt;blazor-island attach&gt;</c>
/// host with <c>display: contents</c>: Blazor renders and owns everything inside it, and the JS instance finds elements
/// with <c>ctx.ref("name")</c> for <c>data-ref="name"</c>.
/// </summary>
public sealed class JSScope : ComponentBase, IAsyncDisposable
{
    private ElementReference _host;
    private DotNetObjectReference<JSComponent>? _dotnet;
    private string? _src;
    private string? _props;
    private string? _key;

    [Inject] private IJSRuntime JS { get; set; } = default!;

    [Inject] private NavigationManager Navigation { get; set; } = default!;

    /// <summary>The component this scope belongs to. Always <c>this</c>.</summary>
    [Parameter, EditorRequired] public JSComponent For { get; set; } = default!;

    /// <summary>The component's markup.</summary>
    [Parameter] public RenderFragment? ChildContent { get; set; }

    /// <summary>
    /// Identity used to keep the JS instance when an interactive renderer replaces prerendered markup. Several
    /// instances of one component on a page are matched in document order; set this when that order can change.
    /// </summary>
    [Parameter] public string? Key { get; set; }

    /// <summary>Serializer settings for <see cref="JSComponent.JSParameters"/>.</summary>
    [Parameter] public JsonSerializerOptions? JsonOptions { get; set; }

    /// <inheritdoc />
    protected override void OnParametersSet()
    {
        if (For is null)
        {
            throw new InvalidOperationException($"{nameof(JSScope)} requires For=\"this\".");
        }

        For.Scope = this;
        var module = For.ModuleForScope;
        _src = module == JSModulePaths.Collocated(For.GetType())
            ? JSModulePaths.ResolveCollocated(Assets, module, For.GetType())
            : IslandAssets.Resolve(Assets, module);
        var options = JsonOptions ?? IslandJson.Default;
        var parameters = For.ParametersForScope;
        if (parameters is JSParameterValues values)
        {
            // Parameter names follow the property naming policy (camelCase by default), like any serialized object.
            parameters = values.ToDictionary(p => options.PropertyNamingPolicy?.ConvertName(p.Key) ?? p.Key, p => p.Value);
        }

        _props = parameters is null ? null : JsonSerializer.Serialize(parameters, parameters.GetType(), options);
        _key = $"{IslandAssets.PagePath(Navigation)}|js:{module}#{Key}";
    }

    /// <inheritdoc />
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenElement(0, "blazor-island");
        builder.AddAttribute(1, "attach", true);
        builder.AddAttribute(2, "src", _src);
        builder.AddAttribute(3, "island-key", _key);
        if (_props is not null)
        {
            builder.AddAttribute(4, "props", _props);
        }

        // "interactive-pending" on a prerender of an interactive component: JS calls to .NET wait instead of failing.
        if (RendererInfo.IsInteractive)
        {
            builder.AddAttribute(5, "interactive", true);
        }
        else if (For.HasInteractiveRenderMode)
        {
            builder.AddAttribute(6, "interactive-pending", true);
        }

        builder.AddElementReferenceCapture(7, r => _host = r);
        builder.AddContent(8, ChildContent);
        builder.CloseElement();
    }

    /// <inheritdoc />
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender && RendererInfo.IsInteractive)
        {
            _dotnet = DotNetObjectReference.Create(For);
            await JS.InvokeVoidAsync("BlazorIslands.connect", _host, _dotnet);
        }
    }

    internal async ValueTask<TValue> InvokeAsync<TValue>(string method, object?[] args)
        => await JS.InvokeAsync<TValue>("BlazorIslands.invoke", _host, method, args);

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        // No JS call here: by the time a component is disposed its element is usually gone, and an exception escaping
        // disposal would terminate the circuit. The runtime forgets the reference when the JS instance unmounts, and a
        // call that races disposal is rejected by JS interop rather than reaching a disposed component.
        _dotnet?.Dispose();
        _dotnet = null;
        return ValueTask.CompletedTask;
    }
}

/// <summary>The default <see cref="JSComponent.JSParameters"/>: parameter values keyed by property name.</summary>
internal sealed class JSParameterValues : Dictionary<string, object?>
{
}

internal static class JSModulePaths
{
    /// <summary>
    /// The URL of a component's collocated <c>.razor.js</c>. The folder comes from the namespace (minus the assembly
    /// name), the same convention the Razor SDK uses to place collocated files. Files in the app itself are served from
    /// the root; files in any other assembly from <c>_content/{AssemblyName}/</c>.
    /// </summary>
    public static string Collocated(Type type)
    {
        var assembly = type.Assembly.GetName().Name ?? "";
        var ns = type.Namespace ?? "";
        var folder = ns == assembly ? "" : ns.StartsWith(assembly + ".", StringComparison.Ordinal) ? ns[(assembly.Length + 1)..] : ns;
        var name = type.Name;
        var tick = name.IndexOf('`');
        if (tick >= 0)
        {
            name = name[..tick];
        }

        return (folder.Length == 0 ? "" : folder.Replace('.', '/') + "/") + name + ".razor.js";
    }

    /// <summary>
    /// Finds the collocated file in the asset manifest. The app and its Blazor Web App client project serve collocated
    /// files from the root; Razor class libraries serve them from <c>_content/{AssemblyName}/</c>. Falls back to the
    /// root path when the manifest knows neither (no MapStaticAssets).
    /// </summary>
    public static string ResolveCollocated(ResourceAssetCollection assets, string relative, Type type)
    {
        foreach (var candidate in new[] { relative, $"_content/{type.Assembly.GetName().Name}/{relative}" })
        {
            var resolved = assets[candidate];
            if (!string.Equals(resolved, candidate, StringComparison.Ordinal))
            {
                return resolved;
            }
        }

        return relative;
    }
}
