/// Solid islands written in F#. Oxpecker.Solid's Fable plugin compiles [<SolidComponent>] functions to Solid JSX, and the
/// sample's build compiles that JSX with babel-preset-solid, exactly as for a TSX Solid component.
module IslandsSample.Fable.Solid

open Fable.Core
open Fable.Core.JsInterop
open Oxpecker.Solid
open BlazorIslands.Fable
open IslandsSample.Shared

[<Import("solidIslands", "@blazor-islands/client/solid")>]
let private solidIslands (components: obj) : obj = jsNative

[<Import("useIsland", "@blazor-islands/client/solid")>]
let private useIsland () : IslandContext = jsNative

/// `props` is the island's props store: read its fields inside the markup and they stay reactive, so new props from the
/// server update the text in place while `count` (a signal) keeps its value.
[<SolidComponent>]
let Card (props: CardProps) : HtmlElement =
    let island = useIsland ()
    let count, setCount = createSignal props.Start
    onMount (fun () -> (lifecycle "fsharp-solid").mounts <- (lifecycle "fsharp-solid").mounts + 1)
    onCleanup (fun () -> (lifecycle "fsharp-solid").unmounts <- (lifecycle "fsharp-solid").unmounts + 1)

    div(class' = "card") {
        h3().attr("data-testid", "title") { props.Title }
        p().attr("data-testid", "framework") { props.Framework }
        button(type' = "button", onClick = fun _ -> setCount (count () + 1)).attr("data-testid", "increment") { "+1" }
        output().attr("data-testid", "count") { string (count ()) }
        ul().attr("data-testid", "items") {
            For(each = props.Items) {
                yield fun item _ -> li() { item }
            }
        }
        button(
            type' = "button",
            onClick = fun _ -> island.emit ("card-click", createObj [ "framework" ==> "fsharp-solid"; "count" ==> count () ])
        )
            .attr("data-testid", "emit") { "Emit" }
    }

let islands = solidIslands (createObj [ "Card" ==> Card ])
