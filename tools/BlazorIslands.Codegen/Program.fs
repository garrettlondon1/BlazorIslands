module BlazorIslands.Codegen.Program

open System
open System.IO
open System.Reflection
open System.Runtime.Loader
open BlazorIslands

/// Loads an assembly and everything it depends on from its own deps.json, sharing BlazorIslands.Server with this tool
/// so [TypeScript] attributes are recognised by type identity.
type private PluginLoadContext(path: string) =
    inherit AssemblyLoadContext($"codegen:{Path.GetFileName path}", isCollectible = false)
    let resolver = AssemblyDependencyResolver(path)
    override _.Load(name: AssemblyName) =
        if name.Name = typeof<TypeScriptAttribute>.Assembly.GetName().Name || name.Name = "FSharp.Core" then null
        else
            match resolver.ResolveAssemblyToPath name with
            | null -> null
            | p -> base.LoadFromAssemblyPath p
    override _.LoadUnmanagedDll(name: string) =
        match resolver.ResolveUnmanagedDllToPath name with
        | null -> IntPtr.Zero
        | p -> base.LoadUnmanagedDllFromPath p

let private usage () =
    eprintfn "Usage: blazor-islands-codegen <assembly.dll> [more.dll ...] --out <file.ts> [--check]"
    eprintfn ""
    eprintfn "Writes TypeScript declarations for every [TypeScript] type in the assemblies and every type they reference."
    eprintfn "--check  exit 1 instead of writing when the file is out of date (for CI)."
    2

[<EntryPoint>]
let main argv =
    let args = List.ofArray argv
    let rec parse inputs out check rest =
        match rest with
        | [] -> inputs |> List.rev, out, check
        | ("--out" | "-o") :: value :: tail -> parse inputs (Some value) check tail
        | "--check" :: tail -> parse inputs out true tail
        | ("--help" | "-h") :: _ -> [], None, false
        | value :: tail -> parse (value :: inputs) out check tail
    match parse [] None false args with
    | [], _, _
    | _, None, _ -> usage ()
    | inputs, Some out, check ->
        try
            let paths =
                inputs
                |> List.map (fun p ->
                    let full = Path.GetFullPath p
                    if not (File.Exists full) then failwith $"Assembly not found: {full}"
                    full)
            // One context for every input, so an assembly referenced by two inputs is loaded once and its types are shared.
            let context = PluginLoadContext(List.head paths)
            let assemblies =
                paths
                |> List.map (fun full ->
                    let name = AssemblyName.GetAssemblyName full
                    match context.Assemblies |> Seq.tryFind (fun a -> a.GetName().Name = name.Name) with
                    | Some loaded -> loaded
                    | None ->
                        try context.LoadFromAssemblyName name
                        with _ -> context.LoadFromAssemblyPath full)
            let text = TypeScriptGenerator().GenerateFrom assemblies
            let full = Path.GetFullPath out
            let existing = if File.Exists full then File.ReadAllText full else null
            if existing = text then
                printfn $"{out} is up to date."
                0
            elif check then
                eprintfn $"{out} is out of date. Run blazor-islands-codegen without --check."
                1
            else
                Directory.CreateDirectory(Path.GetDirectoryName full) |> ignore
                File.WriteAllText(full, text)
                printfn $"Wrote {out}."
                0
        with e ->
            eprintfn $"blazor-islands-codegen: {e.Message}"
            1


