using System.Text.Json;
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Running;
using BlazorIslands;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.JSInterop;

if (args is ["--loop", var which, ..])
{
    // For dotnet-trace: render one benchmark in a tight loop so CPU samples land on it.
    var bench = new StaticRender { Count = 50 };
    bench.Setup();
    Func<Task<string>> op = which switch
    {
        "island" => bench.Island,
        "jscomponent" => bench.JSComponent,
        _ => bench.HandWritten,
    };
    var until = DateTime.UtcNow.AddSeconds(args.Length > 2 ? int.Parse(args[2], System.Globalization.CultureInfo.InvariantCulture) : 10);
    var n = 0;
    while (DateTime.UtcNow < until)
    {
        await op();
        n++;
    }

    Console.WriteLine($"{which}: {n} renders");
    bench.Cleanup();
    return;
}

BenchmarkSwitcher.FromAssembly(typeof(StaticRender).Assembly).Run(args);

/// <summary>Island props: the shape of a typical small island (a few scalars, a short list, an enum).</summary>
public sealed record CardProps(int Id, string Title, double[] Values, Tone Tone, bool Pinned);

public enum Tone { Neutral, Good, Bad }

/// <summary>
/// The cost of rendering N islands or JS components into a static SSR page, against the markup a developer would write by
/// hand for the same result (an element with a JSON props attribute, serialized with the same options). Measured with
/// Blazor's own HtmlRenderer, the static SSR code path; a fresh renderer per operation, as per request.
/// </summary>
[MemoryDiagnoser]
[ShortRunJob]
public class StaticRender
{
    private ServiceProvider _services = default!;
    private ParameterView _parameters;

    [Params(1, 50)]
    public int Count { get; set; }

    [GlobalSetup]
    public void Setup()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<ILoggerFactory>(NullLoggerFactory.Instance);
        services.AddSingleton<NavigationManager>(new StaticNavigationManager());
        services.AddSingleton<IJSRuntime, NoJSRuntime>();
        services.AddScoped<CspNonce>();
        services.AddAntiforgery();
        services.AddSingleton<AntiforgeryStateProvider>(new FixedAntiforgery());
        _services = services.BuildServiceProvider();
        var props = Enumerable.Range(0, Count)
            .Select(i => new CardProps(i, $"Card {i}", [1.5, 2.25, 3, 4.75, 5], (Tone)(i % 3), i % 2 == 0))
            .ToArray();
        _parameters = ParameterView.FromDictionary(new Dictionary<string, object?> { ["Props"] = props });
    }

    [GlobalCleanup]
    public void Cleanup() => _services.Dispose();

    private async Task<string> RenderAsync<TPage>() where TPage : IComponent
    {
        await using var scope = _services.CreateAsyncScope();
        await using var renderer = new HtmlRenderer(scope.ServiceProvider, NullLoggerFactory.Instance);
        var parameters = _parameters;
        return await renderer.Dispatcher.InvokeAsync(async () => (await renderer.RenderComponentAsync<TPage>(parameters)).ToHtmlString());
    }

    [Benchmark(Baseline = true, Description = "hand-written <div props=json>")]
    public Task<string> HandWritten() => RenderAsync<HandWrittenPage>();

    [Benchmark(Description = "<Island Module Props>")]
    public Task<string> Island() => RenderAsync<IslandPage>();

    [Benchmark(Description = "plain component (no JS)")]
    public Task<string> PlainComponent() => RenderAsync<PlainComponentPage>();

    [Benchmark(Description = "JSComponent + JSScope")]
    public Task<string> JSComponent() => RenderAsync<JSComponentPage>();
}

/// <summary>The once-per-page head: import map, runtime script, config meta, two bundle preloads.</summary>
[MemoryDiagnoser]
[ShortRunJob]
public class Head
{
    private ServiceProvider _services = default!;

    [GlobalSetup]
    public void Setup()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<ILoggerFactory>(NullLoggerFactory.Instance);
        services.AddSingleton<NavigationManager>(new StaticNavigationManager());
        services.AddScoped<CspNonce>();
        services.AddAntiforgery();
        services.AddSingleton<AntiforgeryStateProvider>(new FixedAntiforgery());
        _services = services.BuildServiceProvider();
    }

    [GlobalCleanup]
    public void Cleanup() => _services.Dispose();

    private async Task<string> RenderAsync<TPage>() where TPage : IComponent
    {
        await using var scope = _services.CreateAsyncScope();
        await using var renderer = new HtmlRenderer(scope.ServiceProvider, NullLoggerFactory.Instance);
        return await renderer.Dispatcher.InvokeAsync(async () => (await renderer.RenderComponentAsync<TPage>()).ToHtmlString());
    }

    [Benchmark(Baseline = true, Description = "<ImportMap /> (framework)")]
    public Task<string> FrameworkImportMap() => RenderAsync<FrameworkHead>();

    [Benchmark(Description = "<IslandsHead /> + 2x <IslandBundle />")]
    public Task<string> IslandsHead() => RenderAsync<IslandsHeadPage>();
}

/// <summary>Props serialization alone, the per-island cost that scales with props size.</summary>
[MemoryDiagnoser]
[ShortRunJob]
public class Props
{
    private readonly CardProps _props = new(7, "Card 7", [1.5, 2.25, 3, 4.75, 5], Tone.Good, true);
    private readonly JsonSerializerOptions _options = IslandJson.CreateOptions();

    [Benchmark(Baseline = true, Description = "JsonSerializer.Serialize<T>")]
    public string Direct() => JsonSerializer.Serialize(_props, _options);

    [Benchmark(Description = "IslandJson.Serialize (runtime type)")]
    public string Island() => IslandJson.Serialize(_props, null);
}

public abstract class PageBase : ComponentBase
{
    [Parameter] public CardProps[] Props { get; set; } = [];
}

public sealed class HandWrittenPage : PageBase
{
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        foreach (var p in Props)
        {
            builder.OpenElement(0, "div");
            builder.AddAttribute(1, "data-module", "islands/card.js");
            builder.AddAttribute(2, "props", JsonSerializer.Serialize(p, IslandJson.Default));
            builder.AddAttribute(3, "id", $"card-{p.Id}");
            builder.AddMarkupContent(4, "<p>Loading…</p>");
            builder.CloseElement();
        }
    }
}

public sealed class IslandPage : PageBase
{
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        foreach (var p in Props)
        {
            builder.OpenComponent<Island>(0);
            builder.AddComponentParameter(1, nameof(BlazorIslands.Island.Module), "islands/card.js");
            builder.AddComponentParameter(2, nameof(BlazorIslands.Island.Props), p);
            builder.AddComponentParameter(3, "id", $"card-{p.Id}");
            builder.AddComponentParameter(4, nameof(BlazorIslands.Island.ChildContent), (RenderFragment)(b => b.AddMarkupContent(0, "<p>Loading…</p>")));
            builder.CloseComponent();
        }
    }
}

public sealed class PlainComponentPage : PageBase
{
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        foreach (var p in Props)
        {
            builder.OpenComponent<PlainCard>(0);
            builder.AddComponentParameter(1, nameof(PlainCard.Title), p.Title);
            builder.AddComponentParameter(2, nameof(PlainCard.Values), p.Values);
            builder.AddComponentParameter(3, nameof(PlainCard.Tone), p.Tone);
            builder.CloseComponent();
        }
    }
}

public sealed class JSComponentPage : PageBase
{
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        foreach (var p in Props)
        {
            builder.OpenComponent<JSCard>(0);
            builder.AddComponentParameter(1, nameof(JSCard.Title), p.Title);
            builder.AddComponentParameter(2, nameof(JSCard.Values), p.Values);
            builder.AddComponentParameter(3, nameof(JSCard.Tone), p.Tone);
            builder.CloseComponent();
        }
    }
}

public sealed class PlainCard : ComponentBase
{
    [Parameter] public string Title { get; set; } = "";
    [Parameter] public double[] Values { get; set; } = [];
    [Parameter] public Tone Tone { get; set; }

    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenElement(0, "div");
        builder.AddAttribute(1, "class", "card");
        builder.OpenElement(2, "h3");
        builder.AddContent(3, Title);
        builder.CloseElement();
        builder.AddMarkupContent(4, "<canvas data-ref=\"chart\"></canvas>");
        builder.CloseElement();
    }
}

/// <summary>The same card with a JS half (Charts/JSCard.razor.js): parameters flow to JS automatically.</summary>
public sealed class JSCard : BlazorIslands.JSComponent
{
    [Parameter] public string Title { get; set; } = "";
    [Parameter] public double[] Values { get; set; } = [];
    [Parameter] public Tone Tone { get; set; }

    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenComponent<JSScope>(0);
        builder.AddComponentParameter(1, nameof(JSScope.For), this);
        builder.AddComponentParameter(2, nameof(JSScope.ChildContent), (RenderFragment)(b =>
        {
            b.OpenElement(0, "div");
            b.AddAttribute(1, "class", "card");
            b.OpenElement(2, "h3");
            b.AddContent(3, Title);
            b.CloseElement();
            b.AddMarkupContent(4, "<canvas data-ref=\"chart\"></canvas>");
            b.CloseElement();
        }));
        builder.CloseComponent();
    }
}

public sealed class FrameworkHead : ComponentBase
{
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenComponent<ImportMap>(0);
        builder.AddComponentParameter(1, nameof(ImportMap.ImportMapDefinition), ImportMapDefinition.FromResourceCollection(ResourceAssetCollection.Empty));
        builder.CloseComponent();
    }
}

public sealed class IslandsHeadPage : ComponentBase
{
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenComponent<IslandsHead>(0);
        builder.CloseComponent();
        builder.OpenComponent<IslandBundle>(1);
        builder.AddComponentParameter(2, nameof(IslandBundle.Src), "islands/react-app.js");
        builder.CloseComponent();
        builder.OpenComponent<IslandBundle>(3);
        builder.AddComponentParameter(4, nameof(IslandBundle.Src), "islands/preact-bundle.js");
        builder.CloseComponent();
    }
}

internal sealed class StaticNavigationManager : NavigationManager
{
    public StaticNavigationManager() => Initialize("http://localhost/", "http://localhost/dashboard");
}

internal sealed class NoJSRuntime : IJSRuntime
{
    public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => throw new InvalidOperationException();

    public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args) => throw new InvalidOperationException();
}

internal sealed class FixedAntiforgery : AntiforgeryStateProvider
{
    public override AntiforgeryRequestToken? GetAntiforgeryToken() => new("token", "__RequestVerificationToken");
}
