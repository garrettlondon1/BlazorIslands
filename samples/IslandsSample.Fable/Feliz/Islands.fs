/// React islands written in F# with Feliz. [<ReactComponent>] functions compile to ordinary React function components,
/// so they plug into the same React adapter as TSX components.
module IslandsSample.Fable.Feliz

open Fable.Core
open Fable.Core.JsInterop
open Feliz
open BlazorIslands.Fable
open IslandsSample.Shared

[<Import("reactIslands", "@blazor-islands/client/react")>]
let private reactIslands (components: obj) : obj = jsNative

[<Import("useIsland", "@blazor-islands/client/react")>]
let private useIsland () : IslandContext = jsNative

/// New props from the server re-render the component in place: `count` (useState) keeps its value.
[<ReactComponent>]
let Card (props: CardProps) =
    let island = useIsland ()
    let count, setCount = React.useState props.Start
    React.useEffectOnce (fun () ->
        (lifecycle "feliz").mounts <- (lifecycle "feliz").mounts + 1
        { new System.IDisposable with
            member _.Dispose() = (lifecycle "feliz").unmounts <- (lifecycle "feliz").unmounts + 1 })

    Html.div [
        prop.className "card"
        prop.children [
            Html.h3 [ prop.custom ("data-testid", "title"); prop.text props.Title ]
            Html.p [ prop.custom ("data-testid", "framework"); prop.text props.Framework ]
            Html.button [
                prop.type' "button"
                prop.custom ("data-testid", "increment")
                prop.onClick (fun _ -> setCount (count + 1))
                prop.text "+1"
            ]
            Html.output [ prop.custom ("data-testid", "count"); prop.text (string count) ]
            Html.ul [
                prop.custom ("data-testid", "items")
                prop.children [ for item in props.Items -> Html.li [ prop.key item; prop.text item ] ]
            ]
            Html.button [
                prop.type' "button"
                prop.custom ("data-testid", "emit")
                prop.onClick (fun _ -> island.emit ("card-click", createObj [ "framework" ==> "feliz"; "count" ==> count ]))
                prop.text "Emit"
            ]
        ]
    ]

let islands = reactIslands (createObj [ "Card" ==> Card ])
