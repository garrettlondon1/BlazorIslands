module BlazorIslands.Server.Tests.TypeScriptTests

open System
open Xunit
open BlazorIslands
open BlazorIslands.TestTypes
open BlazorIslands.Server.Tests

let generate (types: Type list) = TypeScriptGenerator().Generate types

[<Fact>]
let ``C# record: nullability, primitives, collections, dictionaries and nested types`` () =
    let ts = generate [ typeof<Order> ]
    Assert.Equal<string list>(
        [ "id: number;"
          "customer: string;"
          "notes: string | null;"
          "total: number;"
          "placedAt: string;"
          "reference: string;"
          "discount: number | null;"
          "priority: Priority;"
          "lines: OrderLine[];"
          "tags: (string | null)[];"
          "labels: string[];"
          "counts: Record<string, number>;"
          "byPriority: Record<Priority, string | null>;"
          "shipping: Address | null;"
          "firstPage: Page<OrderLine>;"
          "extra: unknown;"
          "signature: string;" ],
        Text.iface "Order" ts)

[<Fact>]
let ``enums become string-literal unions honoring JsonStringEnumMemberName`` () =
    let ts = generate [ typeof<Order> ]
    Assert.Contains("export type Priority = \"Low\" | \"High\" | \"urgent!\";", ts)

[<Fact>]
let ``classes honor JsonPropertyName and JsonIgnore, quote non-identifier keys and skip indexers`` () =
    let ts = generate [ typeof<Address> ]
    Assert.Equal<string list>([ "street: string;"; "line2: string | null;"; "\"zip-code\": string;" ], Text.iface "Address" ts)

[<Fact>]
let ``generic types are declared once with type parameters`` () =
    let ts = generate [ typeof<Order> ]
    Assert.Equal<string list>([ "items: T[];"; "first: T;"; "total: number;" ], Text.iface "Page" ts)
    Assert.Contains("export interface Page<T> {", ts)

[<Fact>]
let ``recursive types terminate`` () =
    let ts = generate [ typeof<Node> ]
    Assert.Equal<string list>([ "name: string;"; "children: Node[];"; "parent: Node | null;" ], Text.iface "Node" ts)

[<Fact>]
let ``F# record: options, voptions, lists, maps, sets and enums`` () =
    let ts = generate [ typeof<FsRecord> ]
    Assert.Equal<string list>(
        [ "name: string;"
          "nick: string | null;"
          "score: number | null;"
          "tags: string[];"
          "lookup: Record<string, number>;"
          "unique: number[];"
          "kind: FsKind;"
          "when: string;" ],
        Text.iface "FsRecord" ts)
    Assert.Contains("export type FsKind = \"Alpha\" | \"Beta\";", ts)

[<Fact>]
let ``F# unions are rejected with guidance`` () =
    let e = Assert.Throws<NotSupportedException>(fun () -> generate [ typeof<HasUnion> ] |> ignore)
    Assert.Contains("F# union", e.Message)

[<Fact>]
let ``tuples and object dictionary keys are rejected`` () =
    Assert.Throws<NotSupportedException>(fun () -> generate [ typeof<WithTuple> ] |> ignore) |> ignore
    Assert.Throws<NotSupportedException>(fun () -> generate [ typeof<WithObjectKey> ] |> ignore) |> ignore

[<Fact>]
let ``GenerateFrom finds every TypeScript-attributed type, sorted and deduplicated`` () =
    let ts = TypeScriptGenerator().GenerateFrom [ typeof<Order>.Assembly; typeof<FsRecord>.Assembly; typeof<Order>.Assembly ]
    let declarations = Text.lines ts |> List.filter (fun l -> l.StartsWith "export ")
    Assert.Equal(declarations.Length, (declarations |> List.distinct).Length)
    Assert.Contains("export interface Order {", ts)
    Assert.Contains("export interface FsRecord {", ts)
    Assert.DoesNotContain("export interface HasUnion", ts)

[<Fact>]
let ``output is deterministic and ends with a single newline`` () =
    let a = generate [ typeof<Order>; typeof<FsRecord> ]
    let b = generate [ typeof<Order>; typeof<FsRecord> ]
    Assert.Equal(a, b)
    Assert.EndsWith(";\n", a)
    Assert.DoesNotContain("\r", a)
    Assert.False(a.EndsWith "\n\n")

[<Fact>]
let ``a custom naming policy is respected`` () =
    let options = TypeScriptOptions()
    let json = Text.Json.JsonSerializerOptions(Text.Json.JsonSerializerDefaults.Web)
    json.PropertyNamingPolicy <- Text.Json.JsonNamingPolicy.SnakeCaseLower
    options.JsonSerializerOptions <- json
    let ts = TypeScriptGenerator(options).Generate [ typeof<OrderLine> ]
    Assert.Equal<string list>([ "sku: string;"; "quantity: number;" ], Text.iface "OrderLine" ts)
    let ts2 = TypeScriptGenerator(options).Generate [ typeof<Order> ]
    Assert.Contains("placed_at: string;", ts2)



