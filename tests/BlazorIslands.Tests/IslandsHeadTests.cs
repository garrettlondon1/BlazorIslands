using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.Extensions.DependencyInjection;

namespace BlazorIslands.Tests;

public class IslandsHeadTests
{
    private static Task<string> RenderHead(Dictionary<string, object?>? parameters = null, bool withCsp = true, string? token = "tok") =>
        Render.HtmlAsync<IslandsHead>(parameters, services =>
        {
            if (withCsp)
            {
                services.AddScoped<CspNonce>();
            }

            services.AddAntiforgery();
            if (token is not null)
            {
                services.AddSingleton<AntiforgeryStateProvider>(new FixedAntiforgery(token));
            }
        });

    [Fact]
    public async Task Renders_config_meta_import_map_and_runtime_script_in_order()
    {
        var html = await RenderHead();
        var meta = html.IndexOf("<meta name=\"blazor-islands\"", StringComparison.Ordinal);
        var map = html.IndexOf("<script type=\"importmap\"", StringComparison.Ordinal);
        var runtime = html.IndexOf("<script type=\"module\"", StringComparison.Ordinal);
        Assert.True(meta >= 0 && map > meta && runtime > map, html);
    }

    [Fact]
    public async Task Every_script_carries_the_same_request_nonce()
    {
        var html = await RenderHead();
        var nonces = System.Text.RegularExpressions.Regex.Matches(html, "nonce=\"([^\"]+)\"").Select(m => m.Groups[1].Value).ToList();
        Assert.Equal(2, nonces.Count);
        Assert.Single(nonces.Distinct());
    }

    [Fact]
    public async Task Explicit_nonce_wins_and_no_nonce_without_csp()
    {
        Assert.Contains("nonce=\"abc\"", await RenderHead(new() { [nameof(IslandsHead.Nonce)] = "abc" }));
        Assert.DoesNotContain("nonce=", await RenderHead(withCsp: false));
    }

    [Fact]
    public async Task Config_meta_exposes_the_antiforgery_header_token_and_island_header()
    {
        var html = await RenderHead();
        var config = System.Text.Json.JsonDocument.Parse(Render.Attr(html, "content")).RootElement;
        Assert.Equal("RequestVerificationToken", config.GetProperty("afHeader").GetString());
        Assert.Equal("tok", config.GetProperty("afToken").GetString());
        Assert.Equal(BlazorIslandsExtensions.RequestHeader, config.GetProperty("requestHeader").GetString());
    }

    [Fact]
    public async Task Import_map_maps_the_runtime_adapter_vendored_preact_and_extra_imports()
    {
        var html = await RenderHead(new() { [nameof(IslandsHead.Imports)] = new Dictionary<string, string> { ["lodash"] = "./lib/lodash.js" } });
        var json = html[(html.IndexOf("<script type=\"importmap\"", StringComparison.Ordinal))..];
        json = json[(json.IndexOf('>') + 1)..json.IndexOf("</script>", StringComparison.Ordinal)];
        var imports = System.Text.Json.JsonDocument.Parse(json).RootElement.GetProperty("imports");
        foreach (var specifier in new[] { "@blazor-islands/client", "@blazor-islands/client/preact", "preact", "preact/hooks", "preact/jsx-runtime", "@preact/signals", "@preact/signals-core", "htm", "htm/preact" })
        {
            Assert.True(imports.TryGetProperty(specifier, out var url), specifier);
            Assert.StartsWith("./_content/BlazorIslands/", url.GetString());
        }

        Assert.Equal("./lib/lodash.js", imports.GetProperty("lodash").GetString());
    }

    [Fact]
    public async Task IncludePreact_false_omits_vendored_modules()
    {
        var html = await RenderHead(new() { [nameof(IslandsHead.IncludePreact)] = false });
        Assert.Contains("@blazor-islands/client", html);
        Assert.DoesNotContain("\"preact\"", html);
        Assert.DoesNotContain("htm", html);
    }

    [Fact]
    public async Task Every_mapped_file_ships_in_the_package()
    {
        var wwwroot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../src/BlazorIslands/wwwroot"));
        foreach (var (_, path) in IslandsHead.RuntimeModules.Concat(IslandsHead.VendorModules))
        {
            var file = Path.Combine(wwwroot, path["_content/BlazorIslands/".Length..]);
            Assert.True(File.Exists(file), $"Missing {file}. Run `npm run build -w src/client`.");
        }

        Assert.True(File.Exists(Path.Combine(wwwroot, "BlazorIslands.lib.module.js")), "Blazor JS initializer missing.");
    }
}

public class IslandBundleTests
{
    [Fact]
    public void Preload_integrity_comes_from_the_endpoint_import_map()
    {
        var context = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        Assert.Null(IslandBundle.IntegrityOf(context, "islands/app.abc.js"));

        var map = new Microsoft.AspNetCore.Components.ImportMapDefinition(
            new Dictionary<string, string> { ["./islands/app.js"] = "./islands/app.abc.js" },
            scopes: null,
            integrity: new Dictionary<string, string> { ["./islands/app.abc.js"] = "sha256-xyz" });
        Microsoft.AspNetCore.Http.EndpointHttpContextExtensions.SetEndpoint(context,
            new Microsoft.AspNetCore.Http.Endpoint(null, new Microsoft.AspNetCore.Http.EndpointMetadataCollection(map), "page"));
        Assert.Equal("sha256-xyz", IslandBundle.IntegrityOf(context, "islands/app.abc.js"));
        Assert.Equal("sha256-xyz", IslandBundle.IntegrityOf(context, "/islands/app.abc.js"));
        Assert.Equal("sha256-xyz", IslandBundle.IntegrityOf(context, "./islands/app.abc.js"));
        Assert.Null(IslandBundle.IntegrityOf(context, "islands/other.js"));
    }
    [Fact]
    public async Task Without_an_HttpContext_renders_only_the_hint()
    {
        var html = await Render.HtmlAsync<IslandBundle>(new() { [nameof(IslandBundle.Src)] = "islands/app.js" });
        Assert.Equal("<meta name=\"blazor-islands-bundle\" content=\"islands/app.js\" />", html);
    }
}

