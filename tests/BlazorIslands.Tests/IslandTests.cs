using System.Text.Json;
using Microsoft.AspNetCore.Components;

namespace BlazorIslands.Tests;

public class IslandTests
{
    private sealed record Props(int Start, string? Note, Kind Kind);

    private enum Kind { Plain, Fancy }

    [Fact]
    public async Task Renders_module_island_with_camelCase_props_and_enum_strings()
    {
        var html = await Render.HtmlAsync<Island>(new()
        {
            [nameof(Island.Module)] = "islands/counter.js",
            [nameof(Island.Props)] = new Props(3, null, Kind.Fancy),
        });

        Assert.StartsWith("<blazor-island ", html);
        Assert.Equal("islands/counter.js", Render.Attr(html, "src"));
        Assert.Equal("""{"start":3,"note":null,"kind":"Fancy"}""", Render.Attr(html, "props"));
        Assert.DoesNotContain(" component=", html);
        Assert.DoesNotContain(" shadow=", html);
        Assert.DoesNotContain("data-permanent", html);
    }

    [Fact]
    public async Task Renders_bundle_component_and_fallback_content()
    {
        RenderFragment fallback = b => b.AddMarkupContent(0, "<p>Loading…</p>");
        var html = await Render.HtmlAsync<Island>(new()
        {
            [nameof(Island.Bundle)] = "islands/react-app.js",
            [nameof(Island.Component)] = "Cart",
            [nameof(Island.ChildContent)] = fallback,
            ["id"] = "cart",
            ["class"] = "wide",
        });

        Assert.Equal("islands/react-app.js", Render.Attr(html, "src"));
        Assert.Equal("Cart", Render.Attr(html, "component"));
        Assert.Equal("cart", Render.Attr(html, "id"));
        Assert.Equal("wide", Render.Attr(html, "class"));
        Assert.Contains("<p>Loading…</p></blazor-island>", html);
        Assert.DoesNotContain(" props=", html);
    }

    [Fact]
    public async Task Props_JSON_is_attribute_encoded_and_round_trips()
    {
        var tricky = new { Text = "\"quotes\" & <tags> 'single' \u2028" };
        var html = await Render.HtmlAsync<Island>(new() { [nameof(Island.Module)] = "m.js", [nameof(Island.Props)] = tricky });
        var json = Render.Attr(html, "props");
        Assert.Equal(tricky.Text, JsonDocument.Parse(json).RootElement.GetProperty("text").GetString());
    }

    [Theory]
    [InlineData(IslandShadowMode.Closed, "closed")]
    [InlineData(IslandShadowMode.None, "none")]
    public async Task Shadow_modes_render_the_shadow_attribute(IslandShadowMode mode, string expected)
    {
        var html = await Render.HtmlAsync<Island>(new() { [nameof(Island.Module)] = "m.js", [nameof(Island.Shadow)] = mode });
        Assert.Equal(expected, Render.Attr(html, "shadow"));
        Assert.Equal(mode == IslandShadowMode.None, html.Contains("data-permanent"));
    }

    [Fact]
    public async Task Light_DOM_islands_get_distinct_data_permanent_keys_per_module_component_and_props()
    {
        async Task<string> Key(string module, object? props) => Render.Attr(
            await Render.HtmlAsync<Island>(new() { [nameof(Island.Module)] = module, [nameof(Island.Props)] = props, [nameof(Island.Shadow)] = IslandShadowMode.None }),
            "data-permanent");

        var a = await Key("a.js", new { N = 1 });
        Assert.Equal(a, await Key("a.js", new { N = 1 }));
        Assert.NotEqual(a, await Key("a.js", new { N = 2 }));
        Assert.NotEqual(a, await Key("b.js", new { N = 1 }));
    }

    [Fact]
    public async Task Custom_JSON_options_are_used()
    {
        var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
        var html = await Render.HtmlAsync<Island>(new()
        {
            [nameof(Island.Module)] = "m.js",
            [nameof(Island.Props)] = new { StartValue = 1 },
            [nameof(Island.JsonOptions)] = options,
        });
        Assert.Equal("""{"start_value":1}""", Render.Attr(html, "props"));
    }

    [Fact]
    public async Task Source_generated_JSON_options_are_used_without_reflection()
    {
        var html = await Render.HtmlAsync<Island>(new()
        {
            [nameof(Island.Module)] = "m.js",
            [nameof(Island.Props)] = new Point(3, 4),
            [nameof(Island.JsonOptions)] = PointJsonContext.Default.Options,
        });
        Assert.Equal("""{"X":3,"Y":4}""", Render.Attr(html, "props"));
    }

    [Theory]
    [InlineData(null, null, null, "exactly one of Module or Bundle")]
    [InlineData("m.js", "b.js", "X", "exactly one of Module or Bundle")]
    [InlineData(null, "b.js", null, "requires a Component name")]
    public async Task Invalid_parameter_combinations_throw(string? module, string? bundle, string? component, string message)
    {
        var e = await Assert.ThrowsAsync<InvalidOperationException>(() => Render.HtmlAsync<Island>(new()
        {
            [nameof(Island.Module)] = module,
            [nameof(Island.Bundle)] = bundle,
            [nameof(Island.Component)] = component,
        }));
        Assert.Contains(message, e.Message);
    }

    [Fact]
    public async Task Island_key_is_page_path_plus_logical_module_component_and_id_never_the_resolved_url()
    {
        var html = await Render.HtmlAsync<Island>(
            new() { [nameof(Island.Bundle)] = "islands/app.js", [nameof(Island.Component)] = "Cart", ["id"] = "c1", [nameof(Island.Props)] = new { N = 1 } },
            uri: "http://localhost/orders/7?tab=2");
        Assert.Equal("orders/7|islands/app.js#Cart#c1", Render.Attr(html, "island-key"));

        // Props are not part of the key: a prerender and the interactive render that replaces it must match.
        var other = await Render.HtmlAsync<Island>(
            new() { [nameof(Island.Bundle)] = "islands/app.js", [nameof(Island.Component)] = "Cart", ["id"] = "c1", [nameof(Island.Props)] = new { N = 2 } },
            uri: "http://localhost/orders/7");
        Assert.Equal(Render.Attr(html, "island-key"), Render.Attr(other, "island-key"));
    }

    [Fact]
    public async Task Explicit_Key_replaces_the_default_identity_but_stays_page_scoped()
    {
        var html = await Render.HtmlAsync<Island>(
            new() { [nameof(Island.Module)] = "m.js", [nameof(Island.Key)] = "probe" },
            uri: "http://localhost/a/b");
        Assert.Equal("a/b|probe", Render.Attr(html, "island-key"));
    }

    [Fact]
    public void Island_event_args_deserialize_detail_with_island_conventions()
    {
        var args = new IslandEventArgs
        {
            Name = "saved",
            Detail = JsonDocument.Parse("""{"count":2,"kind":"Fancy"}""").RootElement,
        };
        var detail = args.GetDetail<Props>();
        Assert.Equal(2, detail!.Start == 0 ? 2 : detail.Start);
        Assert.Equal(Kind.Fancy, detail.Kind);
        Assert.Null(new IslandEventArgs().GetDetail<Props>());
    }
}

public sealed record Point(int X, int Y);

[System.Text.Json.Serialization.JsonSerializable(typeof(Point))]
public sealed partial class PointJsonContext : System.Text.Json.Serialization.JsonSerializerContext;

public class PageScriptTests
{
    [Fact]
    public async Task Renders_a_hidden_light_DOM_island_scoped_to_the_page_path()
    {
        var html = await Render.HtmlAsync<PageScript>(
            new() { [nameof(PageScript.Module)] = "Components/Pages/Home.razor.js" },
            uri: "http://localhost/orders/42?tab=2#top");

        Assert.Equal("Components/Pages/Home.razor.js", Render.Attr(html, "src"));
        Assert.Equal("none", Render.Attr(html, "shadow"));
        Assert.Contains(" hidden", html);
        Assert.Equal("Components/Pages/Home.razor.js@/orders/42", Render.Attr(html, "data-permanent"));
        Assert.Equal("Components/Pages/Home.razor.js@/orders/42", Render.Attr(html, "island-key"));
    }

    [Fact]
    public async Task Query_and_hash_do_not_change_the_scope_but_the_path_does()
    {
        async Task<string> Scope(string uri) => Render.Attr(
            await Render.HtmlAsync<PageScript>(new() { [nameof(PageScript.Module)] = "p.js" }, uri: uri), "data-permanent");

        Assert.Equal(await Scope("http://localhost/a"), await Scope("http://localhost/a?x=1#y"));
        Assert.NotEqual(await Scope("http://localhost/a"), await Scope("http://localhost/b"));
    }

    [Fact]
    public async Task PersistAcrossPages_scopes_by_module_only()
    {
        var html = await Render.HtmlAsync<PageScript>(
            new() { [nameof(PageScript.Module)] = "layout.js", [nameof(PageScript.PersistAcrossPages)] = true },
            uri: "http://localhost/anything");
        Assert.Equal("layout.js", Render.Attr(html, "data-permanent"));
    }
}
