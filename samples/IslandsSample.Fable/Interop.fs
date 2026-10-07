/// Fable bindings to the BlazorIslands browser runtime, shared by the Solid and React (Feliz) islands.
module BlazorIslands.Fable

open Fable.Core
open Fable.Core.JsInterop

/// What every island receives: see IslandContext in @blazor-islands/client.
type IslandContext =
    /// Raises an event that <Island OnEvent> receives in interactive render modes.
    abstract emit: name: string * detail: obj -> unit
    /// Aborted when the island unmounts.
    abstract signal: obj
    abstract id: int

/// Each framework's own mount/unmount hooks, counted so the tests can prove the framework cleaned up.
type Lifecycle =
    abstract mounts: int with get, set
    abstract unmounts: int with get, set

let lifecycle (framework: string) : Lifecycle =
    emitJsExpr framework "((globalThis.__cards ??= {})[$0] ??= { mounts: 0, unmounts: 0 })"
