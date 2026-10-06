namespace IslandsSample.Client.Matrix;

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;

/// <summary>
/// The render modes the matrix exercises. "inherit" renders the probe without its own render mode: static SSR in a
/// per-page app, or whatever the global router runs in.
/// </summary>
public static class MatrixModes
{
    public static readonly string[] All = ["static", "stream", "server", "server-np", "wasm", "wasm-np", "auto", "auto-np"];

    public static IComponentRenderMode? For(string kind) => kind switch
    {
        "server" => RenderMode.InteractiveServer,
        "server-np" => new InteractiveServerRenderMode(prerender: false),
        "wasm" => RenderMode.InteractiveWebAssembly,
        "wasm-np" => new InteractiveWebAssemblyRenderMode(prerender: false),
        "auto" => RenderMode.InteractiveAuto,
        "auto-np" => new InteractiveAutoRenderMode(prerender: false),
        _ => null,
    };
}

/// <summary>Island props, shared with the server so they serialize identically from both renderers.</summary>
public sealed record ProbeProps(string Kind, string Renderer, bool Interactive, int Count);
