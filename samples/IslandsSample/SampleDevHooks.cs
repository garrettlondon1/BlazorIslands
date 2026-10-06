namespace IslandsSample;

/// <summary>
/// Hooks the end-to-end tests rely on. Both are inert unless configured.
/// <list type="bullet">
/// <item><c>?slow=ms</c> cookie or <c>Islands:SlowBundleMs</c>: delays every request under /islands/ whose file name starts
/// with "slow", proving islands keep their fallback and Blazor keeps working while island JavaScript is slow.</item>
/// <item><c>BLAZOR_WEB_JS</c>: path to a blazor.web.js built from a local aspnetcore clone, served in place of the
/// framework's copy, so the same suite runs against unreleased Blazor.</item>
/// </list>
/// </summary>
public static class SampleDevHooks
{
    public const string OverridePath = "/_dev/blazor.web.js";

    public static string? BlazorWebJsOverride { get; private set; }

    public static bool StrictDynamic { get; set; }

    public static IApplicationBuilder UseSampleDevHooks(this WebApplication app)
    {
        var overridePath = app.Configuration["BLAZOR_WEB_JS"];
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            if (!File.Exists(overridePath))
            {
                throw new FileNotFoundException("BLAZOR_WEB_JS does not point to a file.", overridePath);
            }

            BlazorWebJsOverride = Path.GetFullPath(overridePath);
            app.Logger.LogWarning("Serving blazor.web.js from {Path}", BlazorWebJsOverride);
        }

        app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? "";
            if (BlazorWebJsOverride is not null && path.Equals(OverridePath, StringComparison.OrdinalIgnoreCase))
            {
                context.Response.ContentType = "text/javascript";
                context.Response.Headers.CacheControl = "no-store";
                await context.Response.SendFileAsync(BlazorWebJsOverride);
                return;
            }

            if (path.StartsWith("/islands/slow", StringComparison.OrdinalIgnoreCase))
            {
                var configured = context.Request.Cookies["slow-ms"] ?? app.Configuration["Islands:SlowBundleMs"];
                if (int.TryParse(configured, out var ms) && ms > 0)
                {
                    await Task.Delay(Math.Min(ms, 30_000), context.RequestAborted);
                }
            }

            await next(context);
        });

        return app;
    }
}

