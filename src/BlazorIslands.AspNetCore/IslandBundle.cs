// Licensed under the MIT license.

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace BlazorIslands;

/// <summary>
/// Starts downloading an island bundle as early as possible, in parallel with blazor.web.js and without blocking it.
/// Place after <see cref="IslandsHead"/> in <c>App.razor</c> (or <c>_Host.cshtml</c> via the component tag helper), or in a
/// page's <c>&lt;HeadContent&gt;</c> for page-specific bundles.
/// <para>
/// On a full page load it renders <c>&lt;link rel="modulepreload"&gt;</c> with the CSP nonce, so the browser fetches the
/// bundle while it is still parsing HTML. It also renders a <c>&lt;meta name="blazor-islands-bundle"&gt;</c> hint which the
/// island runtime imports as soon as it starts, so the bundle is parsed and ready before the first island needs it.
/// On enhanced navigation only the hint is rendered: a newly inserted preload link would carry a nonce the browser
/// no longer honors, while the runtime's own <c>import()</c> is trusted.
/// </para>
/// Islands never wait on Blazor and Blazor never waits on islands: a slow bundle keeps each island's server-rendered
/// fallback on screen until it arrives.
/// </summary>
public sealed class IslandBundle : ComponentBase
{
    [Inject] private IServiceProvider Services { get; set; } = default!;

    [CascadingParameter] private HttpContext? HttpContext { get; set; }

    /// <summary>Bundle path relative to the app base, e.g. <c>islands/react-app.js</c>. Fingerprinted URLs are resolved automatically.</summary>
    [Parameter, EditorRequired] public string Src { get; set; } = "";

    /// <summary>Overrides the CSP nonce. Defaults to the request's <see cref="CspNonce"/>.</summary>
    [Parameter] public string? Nonce { get; set; }

    /// <inheritdoc />
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        var href = IslandAssets.Resolve(Assets, Src);
        if (HttpContext is not null && !IsEnhancedNavigation(HttpContext.Request))
        {
            builder.OpenElement(0, "link");
            builder.AddAttribute(1, "rel", "modulepreload");
            builder.AddAttribute(2, "href", href);
            var nonce = Nonce ?? Services.GetService<CspNonce>()?.Value;
            if (nonce is not null)
            {
                builder.AddAttribute(3, "nonce", nonce);
            }

            builder.CloseElement();
        }

        builder.OpenElement(4, "meta");
        builder.AddAttribute(5, "name", "blazor-islands-bundle");
        builder.AddAttribute(6, "content", href);
        builder.CloseElement();
    }

    /// <summary>Enhanced navigation fetches pages with this Accept header (see NavigationEnhancement.ts in aspnetcore).</summary>
    internal static bool IsEnhancedNavigation(HttpRequest request)
        => request.Headers.Accept.Any(a => a is not null && a.Contains("blazor-enhanced-nav=on", StringComparison.OrdinalIgnoreCase));
}

