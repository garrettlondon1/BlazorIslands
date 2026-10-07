using System.Text.Json;
using BlazorIslands;

namespace IslandsSample;

/// <summary>The same card island, built with each framework. Pages under /frameworks/{name} render it.</summary>
public sealed record FrameworkIsland(string Name, string Label, string Bundle, string? Styles, JsonSerializerOptions? Json)
{
    public static readonly IReadOnlyList<FrameworkIsland> All =
    [
        new("vue", "Vue (SFC)", "islands/vue-bundle.js", "islands/vue-bundle.css", null),
        new("svelte", "Svelte 5", "islands/svelte-bundle.js", "islands/svelte-bundle.css", null),
        // F# islands read record fields by their declared names: IslandJson.Fable keeps them.
        new("solid", "Solid (F#, Oxpecker.Solid)", "islands/solid-bundle.js", "islands/fsharp-card.css", IslandJson.Fable),
        new("feliz", "React (F#, Feliz)", "islands/feliz-bundle.js", "islands/fsharp-card.css", IslandJson.Fable),
    ];

    public static FrameworkIsland? Find(string name) => All.FirstOrDefault(f => f.Name == name);
}
