namespace IslandsSample.Shared

// Compiled by the server (IslandsSample.FSharp) AND by Fable into the F# islands (IslandsSample.Fable.*): one definition
// of the props on both sides of the wire. FABLE_COMPILER hides the .NET-only attribute from Fable.
#if !FABLE_COMPILER
open BlazorIslands
#endif

/// Props for the framework card island, rendered by Vue, Svelte, Solid (F#) and React (F#) alike.
/// Arrays, not F# lists: System.Text.Json writes both as JSON arrays, but only an array is an array in Fable.
#if !FABLE_COMPILER
[<TypeScript>]
#endif
type CardProps =
    { Framework: string
      Title: string
      Start: int
      Items: string[] }
