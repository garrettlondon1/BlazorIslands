// Licensed under the MIT license.

using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;

namespace BlazorIslands;

/// <summary>Where an island renders its DOM.</summary>
public enum IslandShadowMode
{
    /// <summary>
    /// An open shadow root (default). Enhanced navigation and streaming rendering never look inside a shadow root,
    /// so the island's DOM and state survive page updates while its props keep flowing in.
    /// </summary>
    Open,

    /// <summary>A closed shadow root. Same lifecycle as <see cref="Open"/>; scripts outside the island cannot reach in.</summary>
    Closed,

    /// <summary>
    /// No shadow root: the island renders into the element itself, which is marked <c>data-permanent</c> so enhanced
    /// navigation leaves its children alone. Use for libraries that need document-level CSS. The element (and so the
    /// mounted island) is replaced when its module, component or props change.
    /// </summary>
    None,
}

/// <summary>
/// Renders a JavaScript island: an ES module, or a named component inside a bundle, mounted into a
/// <c>&lt;blazor-island&gt;</c> custom element, updated when <see cref="Props"/> change and unmounted when the element
/// leaves the document. Works identically under static SSR, enhanced navigation, streaming rendering and every
/// interactive render mode, and needs no inline script, so it runs under a strict nonce-based Content-Security-Policy.
/// </summary>
/// <example>
/// <code>
/// &lt;Island Module="islands/clock.js" Props="@(new { Zone = "UTC" })"&gt;Loading clock…&lt;/Island&gt;
/// &lt;Island Bundle="islands/react-app.js" Component="Cart" Props="@cart" /&gt;
/// </code>
/// </example>
public sealed class Island : ComponentBase
{
    private string? _src;
    private string? _propsJson;
    private string? _key;

    [Inject] private NavigationManager Navigation { get; set; } = default!;

    /// <summary>A module whose exports are the island (<c>mount</c>/<c>update</c>/<c>unmount</c>, or a default export with them).</summary>
    [Parameter] public string? Module { get; set; }

    /// <summary>A bundle exporting many islands by name (<c>export const islands = { ... }</c>). Requires <see cref="Component"/>.</summary>
    [Parameter] public string? Bundle { get; set; }

    /// <summary>The island name within <see cref="Bundle"/>.</summary>
    [Parameter] public string? Component { get; set; }

    /// <summary>Serialized to JSON (camelCase, enums as strings) and handed to <c>mount</c> and <c>update</c>.</summary>
    [Parameter] public object? Props { get; set; }

    /// <summary>Overrides the props serializer settings.</summary>
    [Parameter] public JsonSerializerOptions? JsonOptions { get; set; }

    /// <summary>Shadow DOM mode. Defaults to <see cref="IslandShadowMode.Open"/>.</summary>
    [Parameter] public IslandShadowMode Shadow { get; set; }

    /// <summary>
    /// Identity of this island on its page. When an interactive renderer (Server, WebAssembly, Auto) starts on a
    /// prerendered page it re-creates every element; the running island is handed to the element with the same key
    /// instead of being mounted twice, keeping its state. Defaults to the module (or bundle and component) plus the
    /// element id; set it when one page renders the same island several times without ids.
    /// </summary>
    [Parameter] public string? Key { get; set; }

    /// <summary>Receives <c>ctx.emit(name, detail)</c> calls. Interactive render modes only.</summary>
    [Parameter] public EventCallback<IslandEventArgs> OnEvent { get; set; }

    /// <summary>Server-rendered fallback, shown until the island mounts and again if it fails to load.</summary>
    [Parameter] public RenderFragment? ChildContent { get; set; }

    /// <summary>Additional attributes for the <c>&lt;blazor-island&gt;</c> element, e.g. <c>class</c> or <c>id</c>.</summary>
    [Parameter(CaptureUnmatchedValues = true)] public IReadOnlyDictionary<string, object>? AdditionalAttributes { get; set; }

    /// <inheritdoc />
    protected override void OnParametersSet()
    {
        var hasModule = !string.IsNullOrWhiteSpace(Module);
        var hasBundle = !string.IsNullOrWhiteSpace(Bundle);
        if (hasModule == hasBundle)
        {
            throw new InvalidOperationException($"{nameof(Island)} requires exactly one of {nameof(Module)} or {nameof(Bundle)}.");
        }

        if (hasBundle && string.IsNullOrWhiteSpace(Component))
        {
            throw new InvalidOperationException($"{nameof(Island)} with a {nameof(Bundle)} requires a {nameof(Component)} name.");
        }

        var logical = hasModule ? Module! : Bundle!;
        _src = IslandAssets.Resolve(Assets, logical);
        _propsJson = Props is null ? null : IslandJson.Serialize(Props, JsonOptions);

        // Keyed by page path and logical module, never the resolved URL: a prerender on the server and the same
        // component on WebAssembly may resolve different (fingerprinted or plain) URLs for one module.
        var id = AdditionalAttributes is not null && AdditionalAttributes.TryGetValue("id", out var value) ? value?.ToString() : null;
        _key = $"{IslandAssets.PagePath(Navigation)}|{Key ?? $"{logical}#{Component}#{id}"}";
    }

    /// <inheritdoc />
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenElement(0, "blazor-island");
        builder.AddMultipleAttributes(1, AdditionalAttributes);
        builder.AddAttribute(2, "src", _src);
        builder.AddAttribute(9, "island-key", _key);
        if (!string.IsNullOrWhiteSpace(Bundle))
        {
            builder.AddAttribute(3, "component", Component);
        }

        if (_propsJson is not null)
        {
            builder.AddAttribute(4, "props", _propsJson);
        }

        if (Shadow != IslandShadowMode.Open)
        {
            builder.AddAttribute(5, "shadow", Shadow == IslandShadowMode.Closed ? "closed" : "none");
        }

        if (Shadow == IslandShadowMode.None)
        {
            // Distinct values stop enhanced navigation from merging this element into a different island.
            builder.AddAttribute(6, "data-permanent", $"{_src}#{Component}#{_propsJson}");
        }

        if (OnEvent.HasDelegate)
        {
            builder.AddAttribute(7, "onislandevent", OnEvent);
        }

        builder.AddContent(8, ChildContent);
        builder.CloseElement();
    }
}

/// <summary>
/// The supported replacement for page-specific <c>&lt;script&gt;</c> tags, which never run after enhanced navigation.
/// The module's <c>mount(ctx)</c> runs when the page is shown (full load or enhanced navigation), <c>ctx.onPageUpdate</c>
/// callbacks run after every enhanced update and streaming batch, and <c>unmount</c> runs when the user navigates away.
/// </summary>
public sealed class PageScript : ComponentBase
{
    private string? _src;
    private string? _scope;

    [Inject] private NavigationManager Navigation { get; set; } = default!;

    /// <summary>Path of the module, e.g. <c>Components/Pages/Dashboard.razor.js</c>.</summary>
    [Parameter, EditorRequired] public string Module { get; set; } = "";

    /// <summary>
    /// Keep the module mounted across navigations between pages that all render it (for example from a layout).
    /// By default each page path gets its own instance: navigating to another page unmounts and remounts it, while
    /// enhanced form posts and streaming updates to the same page keep it mounted.
    /// </summary>
    [Parameter] public bool PersistAcrossPages { get; set; }

    /// <inheritdoc />
    protected override void OnParametersSet()
    {
        _src = IslandAssets.Resolve(Assets, Module);
        if (PersistAcrossPages)
        {
            _scope = Module;
            return;
        }

        _scope = $"{Module}@/{IslandAssets.PagePath(Navigation)}";
    }

    /// <inheritdoc />
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenElement(0, "blazor-island");
        builder.AddAttribute(1, "src", _src);
        builder.AddAttribute(2, "shadow", "none");
        builder.AddAttribute(3, "hidden", true);
        builder.AddAttribute(4, "data-permanent", _scope);
        builder.AddAttribute(5, "island-key", _scope);
        builder.CloseElement();
    }
}

internal static class IslandAssets
{
    /// <summary>The base-relative path without query or fragment.</summary>
    public static string PagePath(NavigationManager navigation)
    {
        var path = navigation.ToBaseRelativePath(navigation.Uri);
        var cut = path.IndexOfAny(['?', '#']);
        return cut >= 0 ? path[..cut] : path;
    }

    public static string Resolve(ResourceAssetCollection assets, string path)
    {
        if (path.Contains("://", StringComparison.Ordinal) || path.StartsWith("//", StringComparison.Ordinal))
        {
            return path;
        }

        var rooted = path.StartsWith('/');
        var key = path.StartsWith("./", StringComparison.Ordinal) ? path[2..] : path.TrimStart('/');
        var resolved = assets[key];
        return rooted && !resolved.StartsWith('/') ? "/" + resolved : resolved;
    }
}


