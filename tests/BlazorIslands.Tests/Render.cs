using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace BlazorIslands.Tests;

/// <summary>Renders components to HTML with the framework's own static renderer, the same code path as static SSR.</summary>
internal static class Render
{
    public static async Task<string> HtmlAsync<TComponent>(
        Dictionary<string, object?>? parameters = null,
        Action<IServiceCollection>? services = null,
        string uri = "http://localhost/") where TComponent : IComponent
    {
        var collection = new ServiceCollection();
        collection.AddLogging();
        collection.AddSingleton<ILoggerFactory>(NullLoggerFactory.Instance);
        collection.AddSingleton<NavigationManager>(new TestNavigationManager(uri));
        collection.AddSingleton<Microsoft.JSInterop.IJSRuntime, UnavailableJSRuntime>();
        services?.Invoke(collection);
        await using var provider = collection.BuildServiceProvider();
        await using var renderer = new HtmlRenderer(provider, provider.GetRequiredService<ILoggerFactory>());
        return await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var view = parameters is null ? ParameterView.Empty : ParameterView.FromDictionary(parameters);
            var output = await renderer.RenderComponentAsync<TComponent>(view);
            return output.ToHtmlString();
        });
    }

    public static string Attr(string html, string name)
    {
        var marker = $" {name}=\"";
        var start = html.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(start >= 0, $"Attribute '{name}' not found in: {html}");
        start += marker.Length;
        return System.Net.WebUtility.HtmlDecode(html[start..html.IndexOf('"', start)]);
    }

    /// <summary>Static rendering never calls JS; any call is a test failure.</summary>
    private sealed class UnavailableJSRuntime : Microsoft.JSInterop.IJSRuntime
    {
        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => throw new InvalidOperationException($"Unexpected JS call '{identifier}' during static rendering.");

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args) => InvokeAsync<TValue>(identifier, args);
    }

    private sealed class TestNavigationManager : NavigationManager
    {
        public TestNavigationManager(string uri) => Initialize("http://localhost/", uri);
    }
}

internal sealed class FixedAntiforgery(string token) : AntiforgeryStateProvider
{
    public override AntiforgeryRequestToken? GetAntiforgeryToken() => new(token, "__RequestVerificationToken");
}
