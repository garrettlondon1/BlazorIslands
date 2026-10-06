namespace IslandsSample;

/// <summary>
/// How the sample app is wired, chosen with <c>Islands:AppMode</c>. The e2e matrix runs the same pages under each one.
/// </summary>
public enum AppMode
{
    /// <summary>Static SSR with enhanced navigation; pages opt into interactivity per component (the template default).</summary>
    Enhanced,

    /// <summary><c>data-enhance-nav="false"</c> on the body: every link is a full page load; forms still opt in with data-enhance.</summary>
    NoEnhancedNav,

    /// <summary><c>Blazor.start({ ssr: { disableDomPreservation: true } })</c>: no enhanced navigation, and streaming replaces content wholesale.</summary>
    NoDomPreservation,

    /// <summary>The router itself is InteractiveServer: one circuit, client-side navigation over the websocket.</summary>
    GlobalServer,

    /// <summary>The router itself is InteractiveWebAssembly: client-side navigation in the browser.</summary>
    GlobalWebAssembly,

    /// <summary>The router itself is InteractiveAuto: Server first, WebAssembly once it is cached.</summary>
    GlobalAuto,
}

public static class AppModes
{
    public static AppMode Current { get; private set; }

    public static void Configure(IConfiguration configuration)
    {
        var value = configuration["Islands:AppMode"]?.Replace("-", "", StringComparison.Ordinal).ToLowerInvariant();
        Current = value switch
        {
            null or "" or "enhanced" => AppMode.Enhanced,
            "noenhancednav" => AppMode.NoEnhancedNav,
            "nodompreservation" => AppMode.NoDomPreservation,
            "globalserver" => AppMode.GlobalServer,
            "globalwasm" or "globalwebassembly" => AppMode.GlobalWebAssembly,
            "globalauto" => AppMode.GlobalAuto,
            _ => throw new InvalidOperationException($"Unknown Islands:AppMode '{configuration["Islands:AppMode"]}'."),
        };
    }

    public static bool IsGlobal => Current is AppMode.GlobalServer or AppMode.GlobalWebAssembly or AppMode.GlobalAuto;
}
