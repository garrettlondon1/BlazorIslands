// Licensed under the MIT license.

using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace BlazorIslands;

/// <summary>Registration helpers for BlazorIslands.</summary>
public static class BlazorIslandsExtensions
{
    /// <summary>
    /// The header the island <c>fetch</c> helper sends on every request. Lets the server tell island calls apart from
    /// browser navigations (for 401/403 instead of login redirects) and forces a CORS preflight for cross-origin callers.
    /// </summary>
    public const string RequestHeader = "X-Blazor-Island";

    /// <summary>
    /// Adds the per-request CSP nonce and antiforgery (which <see cref="IslandsHead"/> exposes to islands), and applies the
    /// island JSON conventions (camelCase, enums as strings) to Minimal API bodies so they match the generated TypeScript.
    /// Pass <paramref name="configureHttpJson"/> = false to leave Minimal API JSON untouched.
    /// </summary>
    public static IServiceCollection AddBlazorIslands(this IServiceCollection services, bool configureHttpJson = true)
    {
        services.AddIslandsCsp();
        services.AddAntiforgery();
        if (configureHttpJson)
        {
            services.ConfigureHttpJsonOptions(options => IslandJson.Configure(options.SerializerOptions));
        }

        return services;
    }

    /// <summary>True when the request came from the island <c>fetch</c> helper.</summary>
    public static bool IsIslandRequest(this HttpRequest request) => request.Headers.ContainsKey(RequestHeader);

    /// <summary>
    /// Validates the antiforgery token that the island <c>fetch</c> helper sends from <see cref="IslandsHead"/> on
    /// unsafe methods (POST, PUT, PATCH, DELETE). Use on minimal API endpoints or groups that islands call with cookie auth:
    /// <c>app.MapGroup("/api").WithIslandAntiforgery()</c>. Safe methods pass through.
    /// </summary>
    public static TBuilder WithIslandAntiforgery<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        builder.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            if (http.Request.IsIslandRequest())
            {
                SuppressStatusCodePages(http);
            }

            if (HttpMethods.IsGet(http.Request.Method) || HttpMethods.IsHead(http.Request.Method) || HttpMethods.IsOptions(http.Request.Method))
            {
                return await next(context);
            }

            var antiforgery = http.RequestServices.GetRequiredService<IAntiforgery>();
            if (!await antiforgery.IsRequestValidAsync(http))
            {
                return Results.Problem(
                    title: "Antiforgery token validation failed.",
                    detail: "Render <IslandsHead /> in the document head and call the API with islandFetch.",
                    statusCode: StatusCodes.Status400BadRequest);
            }

            return await next(context);
        });

        // Minimal APIs would otherwise validate form posts themselves; this filter covers JSON bodies too.
        builder.WithMetadata(new IslandAntiforgeryMetadata());
        return builder;
    }

    /// <summary>
    /// Makes cookie authentication answer island requests with 401/403 instead of redirecting to the login page,
    /// which <c>fetch</c> would otherwise follow and report as an HTML 200. Also stops status-code-page middleware
    /// (<c>UseStatusCodePagesWithReExecute</c>) from replacing those responses with an HTML error page.
    /// </summary>
    public static CookieAuthenticationOptions UseIslandStatusCodes(this CookieAuthenticationOptions options)
    {
        var onLogin = options.Events.OnRedirectToLogin;
        var onDenied = options.Events.OnRedirectToAccessDenied;
        options.Events.OnRedirectToLogin = context =>
        {
            if (context.Request.IsIslandRequest())
            {
                SuppressStatusCodePages(context.HttpContext);
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            }

            return onLogin(context);
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            if (context.Request.IsIslandRequest())
            {
                SuppressStatusCodePages(context.HttpContext);
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            }

            return onDenied(context);
        };
        return options;
    }

    /// <summary>
    /// Island requests expect the API's own status codes and bodies, never an HTML status page. Called by the island
    /// helpers; call it from custom middleware that answers island requests with a bare status code.
    /// </summary>
    public static void SuppressStatusCodePages(HttpContext context)
    {
        if (context.Features.Get<IStatusCodePagesFeature>() is { } feature)
        {
            feature.Enabled = false;
        }
    }

    private sealed class IslandAntiforgeryMetadata : IAntiforgeryMetadata
    {
        public bool RequiresValidation => false;
    }
}



