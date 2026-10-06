namespace BlazorIslands

open System
open System.Collections.Generic
open System.Runtime.CompilerServices
open System.Security.Cryptography
open System.Text
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.DependencyInjection

/// The per-request CSP nonce. Inject it into Razor components that render inline &lt;script&gt; elements
/// (the import map) and pass it as the nonce attribute.
/// The browser keeps the nonce of the FIRST document only: enhanced navigation and streaming responses
/// carry new nonces that the browser ignores, which is why islands never rely on inline scripts.
[<Sealed; AllowNullLiteral>]
type CspNonce() =
    let mutable value: string = null
    member _.Value
        with get () =
            if isNull value then
                let bytes = RandomNumberGenerator.GetBytes 18
                // base64url (allowed by the CSP nonce grammar) never needs HTML attribute encoding.
                value <- Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
            value
    /// True once the value has been read or assigned for this request.
    member _.IsGenerated = not (isNull value)

/// A Content-Security-Policy, built directive by directive. "{nonce}" in any source is replaced with the request nonce.
[<Sealed; AllowNullLiteral>]
type CspPolicyBuilder() =
    let directives = Dictionary<string, ResizeArray<string>>(StringComparer.OrdinalIgnoreCase)
    let order = ResizeArray<string>()

    /// Sets a directive, replacing any existing sources. Pass no sources for value-less directives such as upgrade-insecure-requests.
    member this.Set(directive: string, [<ParamArray>] sources: string[]) =
        if not (directives.ContainsKey directive) then order.Add directive
        directives[directive] <- ResizeArray(sources)
        this

    /// Adds sources to a directive, creating it if needed.
    member this.Add(directive: string, [<ParamArray>] sources: string[]) =
        match directives.TryGetValue directive with
        | true, list -> list.AddRange sources
        | _ -> this.Set(directive, sources) |> ignore
        this

    member this.Remove(directive: string) =
        directives.Remove directive |> ignore
        order.Remove directive |> ignore
        this

    member _.Directives : IReadOnlyDictionary<string, ResizeArray<string>> = directives

    /// Adds 'wasm-unsafe-eval' to script-src, which Blazor WebAssembly needs to compile the .NET runtime. It permits
    /// WebAssembly compilation only, not JavaScript eval.
    member this.AllowWebAssembly() =
        if not (directives.ContainsKey "script-src") then this.Set("script-src", "'self'") |> ignore
        if not (directives["script-src"].Contains "'wasm-unsafe-eval'") then directives["script-src"].Add "'wasm-unsafe-eval'"
        this

    /// Emits "Report-Only" instead of enforcing.
    member val ReportOnly = false with get, set

    /// Builds the header value for a nonce.
    member _.Build(nonce: string) =
        let sb = StringBuilder()
        for d in order do
            if sb.Length > 0 then sb.Append("; ") |> ignore
            sb.Append(d) |> ignore
            for s in directives[d] do
                sb.Append(' ').Append(s.Replace("{nonce}", nonce)) |> ignore
        sb.ToString()

    /// A strict same-origin policy: scripts must come from this origin or carry the request nonce.
    /// No 'unsafe-inline', no 'unsafe-eval', no inline event handlers, no inline style elements, and (unlike
    /// 'strict-dynamic') a script element created at runtime without the nonce is blocked too.
    static member Strict() =
        CspPolicyBuilder()
            .Set("default-src", "'self'")
            .Set("script-src", "'self'", "'nonce-{nonce}'")
            .Set("style-src", "'self'")
            .Set("img-src", "'self'", "data:")
            .Set("font-src", "'self'")
            .Set("connect-src", "'self'")
            .Set("object-src", "'none'")
            .Set("base-uri", "'self'")
            .Set("form-action", "'self'")
            .Set("frame-ancestors", "'none'")

    /// The nonce + 'strict-dynamic' policy recommended by web.dev/strict-csp: only scripts the server rendered with the
    /// nonce are trusted, and everything they load (import(), created script elements) inherits that trust. Supporting
    /// browsers ignore host allow-lists such as 'self', which suits third-party loaders, but code running in a trusted
    /// script can create new scripts.
    static member StrictDynamic() =
        CspPolicyBuilder
            .Strict()
            .Set("script-src", "'self'", "'nonce-{nonce}'", "'strict-dynamic'")

/// Options for UseIslandsCsp.
[<Sealed; AllowNullLiteral>]
type IslandsCspOptions() =
    member val Policy = CspPolicyBuilder.Strict() with get, set
    /// Additional report-only policies, e.g. Trusted Types trials, emitted alongside the enforced one.
    member val ReportOnlyPolicies = ResizeArray<CspPolicyBuilder>() with get
    /// Lets callers choose a different policy per request (tests use this to run the same app under several policies).
    member val PolicySelector: Func<HttpContext, CspPolicyBuilder> = null with get, set

[<Extension; AbstractClass; Sealed>]
type IslandsCspExtensions =

    [<Extension>]
    static member AddIslandsCsp(services: IServiceCollection) =
        services.AddScoped<CspNonce>()

    /// Generates a per-request nonce and sets Content-Security-Policy on every response.
    [<Extension>]
    static member UseIslandsCsp(app: IApplicationBuilder, configure: Action<IslandsCspOptions>) =
        let options = IslandsCspOptions()
        if not (isNull configure) then configure.Invoke options
        app.Use(fun (ctx: HttpContext) (next: RequestDelegate) ->
            let nonce =
                match ctx.RequestServices.GetService<CspNonce>() with
                | null -> invalidOp "Call services.AddIslandsCsp() before app.UseIslandsCsp()."
                | n -> n.Value
            let policy =
                if isNull options.PolicySelector then options.Policy
                else
                    match options.PolicySelector.Invoke ctx with
                    | null -> options.Policy
                    | p -> p
            ctx.Response.OnStarting(fun () ->
                let headers = ctx.Response.Headers
                if not (isNull policy) then
                    let name = if policy.ReportOnly then "Content-Security-Policy-Report-Only" else "Content-Security-Policy"
                    headers[name] <- Microsoft.Extensions.Primitives.StringValues(policy.Build nonce)
                for p in options.ReportOnlyPolicies do
                    headers.Append("Content-Security-Policy-Report-Only", Microsoft.Extensions.Primitives.StringValues(p.Build nonce))
                Threading.Tasks.Task.CompletedTask)
            next.Invoke ctx)

    [<Extension>]
    static member UseIslandsCsp(app: IApplicationBuilder) =
        IslandsCspExtensions.UseIslandsCsp(app, null)



