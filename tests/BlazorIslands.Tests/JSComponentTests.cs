using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.JSInterop;

namespace BlazorIslands.Tests.Widgets
{
    // Namespace mirrors a folder, as the Razor SDK places collocated .razor.js files.
    public sealed class Chart : JSComponent
    {
        [Parameter] public string Title { get; set; } = "";

        [Parameter] public int[] Values { get; set; } = [];

        [Parameter] public RenderFragment? ChildContent { get; set; }

        [Parameter] public EventCallback<int> OnPick { get; set; }

        [Parameter] public Func<int, int>? Transform { get; set; }

        [Parameter] public ElementReference Anchor { get; set; }

        public string Module => JSModule;

        public ValueTask<string> CallJs() => InvokeJSAsync<string>("describe");

        protected override void BuildRenderTree(RenderTreeBuilder builder)
        {
            builder.OpenComponent<JSScope>(0);
            builder.AddComponentParameter(1, nameof(JSScope.For), this);
            builder.AddComponentParameter(2, nameof(JSScope.ChildContent), (RenderFragment)(b => b.AddMarkupContent(0, "<canvas data-ref=\"canvas\"></canvas>")));
            builder.CloseComponent();
        }

        [JSInvokable] public void Picked(int index) => _ = index;
    }

    public sealed class Custom : JSComponent
    {
        protected override string JSModule => "js/custom.js";

        protected override object? JSParameters => new { Mode = "custom", Level = 3 };

        protected override void BuildRenderTree(RenderTreeBuilder builder)
        {
            builder.OpenComponent<JSScope>(0);
            builder.AddComponentParameter(1, nameof(JSScope.For), this);
            builder.AddComponentParameter(2, nameof(JSScope.Key), "first");
            builder.CloseComponent();
        }
    }

    public sealed class NoScope : JSComponent
    {
        public ValueTask<string> CallJs() => InvokeJSAsync<string>("x");

        protected override void BuildRenderTree(RenderTreeBuilder builder) => builder.AddContent(0, "no scope");
    }
}

namespace BlazorIslands.Tests
{
    using BlazorIslands.Tests.Widgets;

    public class JSComponentTests
    {
        [Fact]
        public async Task Renders_an_attach_host_around_Blazor_owned_markup()
        {
            var html = await Render.HtmlAsync<Chart>(new() { [nameof(Chart.Title)] = "Sales", [nameof(Chart.Values)] = new[] { 1, 2 } }, uri: "http://localhost/reports/q3");
            Assert.StartsWith("<blazor-island attach ", html);
            Assert.Contains("<canvas data-ref=\"canvas\"></canvas></blazor-island>", html);
            Assert.DoesNotContain(" shadow=", html);
            Assert.DoesNotContain("data-permanent", html);
            Assert.DoesNotContain(" interactive", html);
        }

        [Fact]
        public async Task Default_parameters_are_the_serializable_Parameter_properties_in_camelCase()
        {
            var html = await Render.HtmlAsync<Chart>(new() { [nameof(Chart.Title)] = "Sales", [nameof(Chart.Values)] = new[] { 1, 2 } });
            // ChildContent, EventCallback, delegates and ElementReference are skipped.
            Assert.Equal("""{"title":"Sales","values":[1,2]}""", Render.Attr(html, "props"));
        }

        [Fact]
        public async Task Collocated_module_path_follows_the_namespace_and_key_is_page_scoped()
        {
            var html = await Render.HtmlAsync<Chart>(uri: "http://localhost/reports/q3?x=1");
            // No asset manifest in this test host: the root-relative collocated path is used as is.
            Assert.Equal("Widgets/Chart.razor.js", Render.Attr(html, "src"));
            Assert.Equal("reports/q3|js:Widgets/Chart.razor.js#", Render.Attr(html, "island-key"));
        }

        [Fact]
        public async Task JSModule_JSParameters_and_Key_can_be_overridden()
        {
            var html = await Render.HtmlAsync<Custom>(uri: "http://localhost/");
            Assert.Equal("js/custom.js", Render.Attr(html, "src"));
            Assert.Equal("""{"mode":"custom","level":3}""", Render.Attr(html, "props"));
            Assert.Equal("|js:js/custom.js#first", Render.Attr(html, "island-key"));
        }

        [Fact]
        public void Collocated_paths_for_generic_and_root_namespace_types()
        {
            Assert.Equal("Widgets/Chart.razor.js", JSModulePaths.Collocated(typeof(Chart)));
            Assert.Equal("Generic.razor.js", JSModulePaths.Collocated(typeof(BlazorIslands.Tests.Generic<int>)));
        }

        [Fact]
        public void Collocated_resolution_prefers_the_app_root_then_the_library_content_path()
        {
            var assets = new ResourceAssetCollection([
                new ResourceAsset("_content/BlazorIslands.Tests/Widgets/Chart.abc123.razor.js", [new ResourceAssetProperty("label", "_content/BlazorIslands.Tests/Widgets/Chart.razor.js")]),
            ]);
            Assert.Equal("_content/BlazorIslands.Tests/Widgets/Chart.abc123.razor.js", JSModulePaths.ResolveCollocated(assets, "Widgets/Chart.razor.js", typeof(Chart)));

            var rooted = new ResourceAssetCollection([
                new ResourceAsset("Widgets/Chart.def456.razor.js", [new ResourceAssetProperty("label", "Widgets/Chart.razor.js")]),
                new ResourceAsset("_content/BlazorIslands.Tests/Widgets/Chart.abc123.razor.js", [new ResourceAssetProperty("label", "_content/BlazorIslands.Tests/Widgets/Chart.razor.js")]),
            ]);
            Assert.Equal("Widgets/Chart.def456.razor.js", JSModulePaths.ResolveCollocated(rooted, "Widgets/Chart.razor.js", typeof(Chart)));

            Assert.Equal("Widgets/Chart.razor.js", JSModulePaths.ResolveCollocated(ResourceAssetCollection.Empty, "Widgets/Chart.razor.js", typeof(Chart)));
        }

        [Fact]
        public async Task Calling_JS_without_a_scope_or_while_static_explains_why()
        {
            var noScope = new NoScope();
            var e1 = await Assert.ThrowsAsync<InvalidOperationException>(async () => await noScope.CallJs());
            Assert.Contains("<JSScope For=\"this\">", e1.Message);
        }

    }
}

namespace BlazorIslands.Tests
{
    public sealed class Generic<T> : JSComponent
    {
    }
}
