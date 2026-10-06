module BlazorIslands.Server.Tests.JsonTests

open System.Text.Json
open Xunit
open BlazorIslands
open BlazorIslands.TestTypes
open BlazorIslands.Server.Tests

[<Fact>]
let ``island JSON matches the generated TypeScript: camelCase, enums as strings, F# options as null`` () =
    let json =
        JsonSerializer.Serialize(
            { Name = "a"; Nick = None; Score = ValueSome 3; Tags = [ "x" ]; Lookup = Map [ "k", 1 ]; Unique = set [ 2 ]
              Kind = FsKind.Beta; When = System.DateTime(2026, 1, 2) },
            IslandJson.Default)
    Assert.Equal("""{"name":"a","nick":null,"score":3,"tags":["x"],"lookup":{"k":1},"unique":[2],"kind":"Beta","when":"2026-01-02T00:00:00"}""", json)

[<Fact>]
let ``enum member names round-trip`` () =
    let json = JsonSerializer.Serialize(Priority.Urgent, IslandJson.Default)
    Assert.Equal("\"urgent!\"", json)
    Assert.Equal(Priority.Urgent, JsonSerializer.Deserialize<Priority>(json, IslandJson.Default))

[<Fact>]
let ``configure is idempotent`` () =
    let o = JsonSerializerOptions()
    IslandJson.Configure o
    IslandJson.Configure o
    Assert.Equal(1, o.Converters.Count)

