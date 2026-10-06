// Licensed under the MIT license.

using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace BlazorIslands;

/// <summary>
/// Renders everything islands need in <c>&lt;head&gt;</c>. Use it in place of <c>&lt;ImportMap /&gt;</c>:
/// <list type="bullet">
/// <item>One import map combining the app's fingerprinted static assets with the island runtime, the Preact adapter and
/// the vendored Preact, hooks, signals and htm builds, carrying the request's CSP nonce.</item>
/// <item>A <c>&lt;script type="module"&gt;</c> (with the nonce) that starts the island runtime. Module scripts are deferred and
/// independent of blazor.web.js, so islands start as soon as their code arrives whether or not Blazor has booted.</item>
/// <item>A <c>&lt;meta name="blazor-islands"&gt;</c> with the antiforgery header name and token, so <c>islandFetch</c>
/// can call the app's own Web APIs with the user's cookie and no inline script.</item>
/// </list>
/// Enhanced navigation re-renders the head, so the antiforgery token follows sign-in and sign-out automatically.
/// </summary>
public sealed class IslandsHead : ComponentBase
{
    internal const string RuntimePath = "_content/BlazorIslands/blazor-islands.js";

    internal static readonly (string Specifier, string Path)[] RuntimeModules =
    [
        ("@blazor-islands/client", RuntimePath),
        ("@blazor-islands/client/preact", "_content/BlazorIslands/preact-adapter.js"),
    ];

    internal static readonly (string Specifier, string Path)[] VendorModules =
    [
        ("preact", "_content/BlazorIslands/vendor/preact.mjs"),
        ("preact/hooks", "_content/BlazorIslands/vendor/preact-hooks.mjs"),
        ("preact/jsx-runtime", "_content/BlazorIslands/vendor/preact-jsx-runtime.mjs"),
        ("@preact/signals-core", "_content/BlazorIslands/vendor/signals-core.mjs"),
        ("@preact/signals", "_content/BlazorIslands/vendor/signals.mjs"),
        ("htm", "_content/BlazorIslands/vendor/htm.mjs"),
        ("htm/preact", "_content/BlazorIslands/vendor/htm-preact.mjs"),
    ];

    [Inject] private IServiceProvider Services { get; set; } = default!;

    [CascadingParameter] private HttpContext? HttpContext { get; set; }

    /// <summary>Include the vendored Preact, hooks, signals and htm modules in the import map. Defaults to true.</summary>
    [Parameter] public bool IncludePreact { get; set; } = true;

    /// <summary>Additional import map entries, e.g. app-specific bare specifiers.</summary>
    [Parameter] public IReadOnlyDictionary<string, string>? Imports { get; set; }

    /// <summary>Overrides the nonce. By default it is the request's <see cref="CspNonce"/> when <c>AddBlazorIslands()</c> is registered.</summary>
    [Parameter] public string? Nonce { get; set; }

    /// <inheritdoc />
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        var nonce = Nonce ?? Services.GetService<CspNonce>()?.Value;

        builder.OpenElement(0, "meta");
        builder.AddAttribute(1, "name", "blazor-islands");
        builder.AddAttribute(2, "content", BuildConfigJson());
        builder.CloseElement();

        builder.OpenComponent<ImportMap>(3);
        builder.AddComponentParameter(4, nameof(ImportMap.ImportMapDefinition), BuildImportMap());
        if (nonce is not null)
        {
            builder.AddComponentParameter(5, nameof(ImportMap.AdditionalAttributes), new Dictionary<string, object> { ["nonce"] = nonce });
        }

        builder.CloseComponent();

        builder.OpenElement(6, "script");
        builder.AddAttribute(7, "type", "module");
        builder.AddAttribute(8, "src", Assets[RuntimePath]);
        if (nonce is not null)
        {
            builder.AddAttribute(9, "nonce", nonce);
        }

        builder.CloseElement();
    }

    internal string BuildConfigJson()
    {
        var antiforgery = Services.GetService<AntiforgeryStateProvider>()?.GetAntiforgeryToken();
        var headerName = Services.GetService<IOptions<AntiforgeryOptions>>()?.Value.HeaderName;
        var config = new Dictionary<string, object?>
        {
            ["afHeader"] = headerName,
            ["afToken"] = antiforgery?.Value,
            ["requestHeader"] = BlazorIslandsExtensions.RequestHeader,
        };
        return JsonSerializer.Serialize(config);
    }

    internal ImportMapDefinition BuildImportMap()
    {
        var imports = new Dictionary<string, string>();
        foreach (var (specifier, path) in RuntimeModules)
        {
            imports[specifier] = "./" + Assets[path];
        }

        if (IncludePreact)
        {
            foreach (var (specifier, path) in VendorModules)
            {
                imports[specifier] = "./" + Assets[path];
            }
        }

        if (Imports is not null)
        {
            foreach (var (key, value) in Imports)
            {
                imports[key] = value;
            }
        }

        var ours = new ImportMapDefinition(imports, scopes: null, integrity: null);
        var endpoint = HttpContext?.GetEndpoint()?.Metadata.GetMetadata<ImportMapDefinition>();
        return endpoint is null ? ours : ImportMapDefinition.Combine(endpoint, ours);
    }
}
