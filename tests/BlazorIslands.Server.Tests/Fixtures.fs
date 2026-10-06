namespace BlazorIslands.Server.Tests

open System
open BlazorIslands

type FsKind =
    | Alpha = 0
    | Beta = 1

[<TypeScript>]
type FsRecord =
    { Name: string
      Nick: string option
      Score: int voption
      Tags: string list
      Lookup: Map<string, int>
      Unique: Set<int>
      Kind: FsKind
      When: DateTime }

type FsUnion =
    | A of int
    | B

type HasUnion = { Value: FsUnion }

module Text =
    /// Collapses the generated module to its declaration lines, ignoring the header comment.
    let lines (ts: string) =
        ts.Split('\n')
        |> Array.map (fun l -> l.TrimEnd('\r'))
        |> Array.filter (fun l -> not (l.StartsWith "//") && not (l.StartsWith "/*") && l <> "")
        |> Array.toList

    /// The body of `export interface Name { ... }` as trimmed member lines.
    let iface (name: string) (ts: string) =
        let all = lines ts
        let start = all |> List.findIndex (fun l -> l.StartsWith $"export interface {name} " || l.StartsWith $"export interface {name}<")
        all |> List.skip (start + 1) |> List.takeWhile (fun l -> l <> "}") |> List.map (fun l -> l.Trim())

