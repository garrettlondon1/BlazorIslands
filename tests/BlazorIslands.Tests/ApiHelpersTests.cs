using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace BlazorIslands.Tests;

public class ApiHelpersTests : IAsyncLifetime
{
    private WebApplication _app = default!;
    private HttpClient _client = default!;

    private enum Kind { Info, Warning }

    private sealed record Body(string Text, Kind Kind);

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddBlazorIslands();
        builder.Services.AddAuthorization();
        builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(o => { o.LoginPath = "/login"; o.UseIslandStatusCodes(); });
        _app = builder.Build();
        _app.UseStatusCodePages(); // Must not turn island 401s into HTML.
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.UseAntiforgery();

        _app.MapGet("/token", (IAntiforgery af, HttpContext ctx) => af.GetAndStoreTokens(ctx).RequestToken);
        _app.MapPost("/signin", async (HttpContext ctx) =>
            await ctx.SignInAsync(new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "ada")], "cookie"))));
        var api = _app.MapGroup("/api").WithIslandAntiforgery();
        api.MapGet("/open", () => "ok");
        api.MapPost("/echo", (Body body) => body);
        api.MapGet("/secret", () => "secret").RequireAuthorization();

        await _app.StartAsync();
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private HttpRequestMessage Island(HttpMethod method, string url, object? body = null, string? token = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add(BlazorIslandsExtensions.RequestHeader, "1");
        if (token is not null)
        {
            request.Headers.Add("RequestVerificationToken", token);
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return request;
    }

    private async Task<(string Token, string Cookie)> GetTokenAsync()
    {
        var response = await _client.GetAsync("/token");
        var cookie = string.Join("; ", response.Headers.GetValues("Set-Cookie").Select(c => c.Split(';')[0]));
        return (await response.Content.ReadAsStringAsync(), cookie);
    }

    [Fact]
    public async Task Safe_methods_need_no_antiforgery_token()
    {
        var response = await _client.SendAsync(Island(HttpMethod.Get, "/api/open"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Unsafe_methods_without_a_token_get_a_problem_400()
    {
        var response = await _client.SendAsync(Island(HttpMethod.Post, "/api/echo", new { text = "x", kind = "Info" }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Antiforgery", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Unsafe_methods_with_a_valid_token_pass_and_use_island_JSON_conventions()
    {
        var (token, cookie) = await GetTokenAsync();
        var request = Island(HttpMethod.Post, "/api/echo", new { text = "hi", kind = "Warning" }, token);
        request.Headers.Add("Cookie", cookie);
        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("""{"text":"hi","kind":"Warning"}""", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Island_requests_get_a_bare_401_while_others_are_redirected_to_login()
    {
        var island = await _client.SendAsync(Island(HttpMethod.Get, "/api/secret"));
        Assert.Equal(HttpStatusCode.Unauthorized, island.StatusCode);
        Assert.Equal("", await island.Content.ReadAsStringAsync());

        var browser = await _client.GetAsync("/api/secret");
        Assert.Equal(HttpStatusCode.Redirect, browser.StatusCode);
        Assert.Contains("/login", browser.Headers.Location!.ToString());
    }

    [Fact]
    public void IsIslandRequest_reads_the_header()
    {
        var ctx = new DefaultHttpContext();
        Assert.False(ctx.Request.IsIslandRequest());
        ctx.Request.Headers[BlazorIslandsExtensions.RequestHeader] = "1";
        Assert.True(ctx.Request.IsIslandRequest());
    }
}
