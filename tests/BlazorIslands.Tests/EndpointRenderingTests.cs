using System.Net;
using BlazorIslands;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace BlazorIslands.Tests;

/// <summary>Renders through the real endpoint pipeline (RazorComponentResult), so HttpContext and CSP are live.</summary>
public class EndpointRenderingTests : IAsyncLifetime
{
    private WebApplication _app = default!;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddRazorComponents();
        builder.Services.AddBlazorIslands();
        _app = builder.Build();
        _app.UseIslandsCsp();
        _app.UseAntiforgery();
        _app.MapGet("/head", () => new RazorComponentResult<HeadPage>());
        await _app.StartAsync();
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static string NonceOf(HttpResponseMessage r) =>
        System.Text.RegularExpressions.Regex.Match(r.Headers.GetValues("Content-Security-Policy").Single(), "'nonce-([^']+)'").Groups[1].Value;

    [Fact]
    public async Task Full_load_renders_modulepreload_with_the_response_nonce_and_the_hint()
    {
        var response = await _client.GetAsync("/head");
        var html = await response.Content.ReadAsStringAsync();
        var nonce = NonceOf(response);
        Assert.Contains($"<link rel=\"modulepreload\" href=\"islands/app.js\" nonce=\"{nonce}\" />", html);
        Assert.Contains("<meta name=\"blazor-islands-bundle\" content=\"islands/app.js\" />", html);
        Assert.Contains($"<script type=\"importmap\" nonce=\"{nonce}\">", html);
        Assert.Contains($"<script type=\"module\" src=\"_content/BlazorIslands/blazor-islands.js\" nonce=\"{nonce}\">", html);
    }

    [Fact]
    public async Task Enhanced_navigation_renders_only_the_hint()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/head");
        request.Headers.TryAddWithoutValidation("Accept", "text/html; blazor-enhanced-nav=on");
        var html = await (await _client.SendAsync(request)).Content.ReadAsStringAsync();
        Assert.DoesNotContain("modulepreload", html);
        Assert.Contains("blazor-islands-bundle", html);
    }

    [Fact]
    public async Task Antiforgery_token_in_the_meta_validates()
    {
        var response = await _client.GetAsync("/head");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var html = await response.Content.ReadAsStringAsync();
        var start = html.IndexOf("<meta name=\"blazor-islands\" content=\"", StringComparison.Ordinal);
        Assert.True(start >= 0);
        var content = WebUtility.HtmlDecode(html[(start + 37)..html.IndexOf('"', start + 37)]);
        var token = System.Text.Json.JsonDocument.Parse(content).RootElement.GetProperty("afToken").GetString();
        Assert.False(string.IsNullOrEmpty(token));
    }

    public sealed class HeadPage : ComponentBase
    {
        protected override void BuildRenderTree(RenderTreeBuilder builder)
        {
            builder.OpenComponent<IslandsHead>(0);
            builder.CloseComponent();
            builder.OpenComponent<IslandBundle>(1);
            builder.AddComponentParameter(2, nameof(IslandBundle.Src), "islands/app.js");
            builder.CloseComponent();
        }
    }
}
