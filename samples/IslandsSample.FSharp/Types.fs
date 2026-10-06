namespace IslandsSample.Shared

open System
open BlazorIslands

/// Severity of a note. Enums cross to TypeScript as string-literal unions.
type NoteKind =
    | Info = 0
    | Warning = 1

/// A note, returned by GET /api/notes. F# records serialize with System.Text.Json and become TypeScript interfaces.
[<TypeScript>]
type Note =
    { Id: int
      Text: string
      Kind: NoteKind
      Author: string
      CreatedAt: DateTimeOffset }

[<TypeScript>]
type ChartPoint = { Label: string; Value: float }

/// Props for the React chart island. F# options become `| null` in TypeScript.
[<TypeScript>]
type ChartProps =
    { Title: string
      Points: ChartPoint list
      Highlight: string option }
