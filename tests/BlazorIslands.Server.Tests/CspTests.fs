module BlazorIslands.Server.Tests.CspTests

open System.Net
open System.Threading.Tasks
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Hosting
open Microsoft.AspNetCore.Http
open Microsoft.AspNetCore.TestHost
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting
open Xunit
open System
open BlazorIslands

let private html (s: string) = Results.Content(s, "text/html; charset=utf-8")

let private startHost (configure: IslandsCspOptions -> unit) =
    task {
        let builder = WebApplication.CreateBuilder()
        builder.WebHost.UseTestServer() |> ignore
        builder.Services.AddIslandsCsp() |> ignore
        let app = builder.Build()
        app.UseIslandsCsp(fun o -> configure o) |> ignore
        app.MapGet("/", Func<CspNonce, IResult>(fun nonce -> html nonce.Value)) |> ignore
        app.MapGet("/twice", Func<CspNonce, IResult>(fun nonce -> html (nonce.Value + "|" + nonce.Value))) |> ignore
        do! app.StartAsync()
        return app
    }

[<Fact>]
let ``only HTML responses get a policy, and nothing else pays for a nonce`` () =
    task {
        let mutable nonceGenerated = false
        let builder = WebApplication.CreateBuilder()
        builder.WebHost.UseTestServer() |> ignore
        builder.Services.AddIslandsCsp() |> ignore
        let app = builder.Build()
        app.UseIslandsCsp() |> ignore
        app.Use(fun (ctx: HttpContext) (next: RequestDelegate) ->
            task {
                do! next.Invoke ctx
                nonceGenerated <-
                    match ctx.RequestServices.GetService<CspNonce>() with
                    | null -> false
                    | nonce -> nonce.IsGenerated
            } :> Task) |> ignore
        app.MapGet("/", Func<CspNonce, IResult>(fun nonce -> html nonce.Value)) |> ignore
        app.MapGet("/asset.js", Func<IResult>(fun () -> Results.Text("export {}", "text/javascript"))) |> ignore
        app.MapGet("/api", Func<IResult>(fun () -> Results.Json {| ok = true |})) |> ignore
        do! app.StartAsync()
        let client = app.GetTestClient()
        let! page = client.GetAsync "/"
        Assert.True(page.Headers.Contains "Content-Security-Policy")
        Assert.True nonceGenerated
        for path in [ "/asset.js"; "/api" ] do
            let! response = client.GetAsync path
            Assert.Equal(HttpStatusCode.OK, response.StatusCode)
            Assert.False(response.Headers.Contains "Content-Security-Policy", path)
            Assert.False(response.Headers.Contains "Content-Security-Policy-Report-Only", path)
            Assert.False(nonceGenerated, path)
        do! app.StopAsync()
    }

[<Fact>]
let ``Strict policy: self + nonce, no unsafe keywords, header nonce matches the request nonce`` () =
    task {
        use! app = startHost ignore
        let client = app.GetTestClient()
        let! response = client.GetAsync "/"
        let! body = response.Content.ReadAsStringAsync()
        let csp = response.Headers.GetValues("Content-Security-Policy") |> Seq.exactlyOne
        Assert.Contains($"script-src 'self' 'nonce-{body}';", csp)
        Assert.DoesNotContain("unsafe", csp)
        Assert.DoesNotContain("strict-dynamic", csp)
        Assert.Contains("object-src 'none'", csp)
        Assert.Contains("frame-ancestors 'none'", csp)
    }

[<Fact>]
let ``nonce is stable within a request, unique across requests and base64url`` () =
    task {
        use! app = startHost ignore
        let client = app.GetTestClient()
        let! a = client.GetStringAsync "/twice"
        let! b = client.GetStringAsync "/twice"
        let parts = a.Split '|'
        Assert.Equal(parts[0], parts[1])
        Assert.NotEqual<string>(a, b)
        Assert.Matches("^[A-Za-z0-9_-]{24}$", parts[0])
    }

[<Fact>]
let ``StrictDynamic adds strict-dynamic and AllowWebAssembly adds wasm-unsafe-eval only`` () =
    task {
        use! app = startHost (fun o -> o.Policy <- CspPolicyBuilder.StrictDynamic())
        let! response = app.GetTestClient().GetAsync "/"
        let csp = response.Headers.GetValues("Content-Security-Policy") |> Seq.exactlyOne
        Assert.Matches("script-src 'self' 'nonce-[A-Za-z0-9_-]+' 'strict-dynamic';", csp)
        let wasm = CspPolicyBuilder.Strict().AllowWebAssembly().AllowWebAssembly().Build "n"
        Assert.Contains("script-src 'self' 'nonce-n' 'wasm-unsafe-eval';", wasm)
        Assert.DoesNotContain("'unsafe-eval'", wasm)
        Assert.Equal(1, wasm.Split("wasm-unsafe-eval").Length - 1)
    }

[<Fact>]
let ``report-only and per-request policies`` () =
    task {
        use! app =
            startHost (fun o ->
                let trial = CspPolicyBuilder().Set("require-trusted-types-for", "'script'")
                trial.ReportOnly <- true
                o.ReportOnlyPolicies.Add trial
                o.PolicySelector <-
                    System.Func<HttpContext, CspPolicyBuilder>(fun ctx ->
                        if ctx.Request.Query.ContainsKey "relaxed" then CspPolicyBuilder().Set("default-src", "*") else null))
        let client = app.GetTestClient()
        let! normal = client.GetAsync "/"
        Assert.Equal("require-trusted-types-for 'script'", normal.Headers.GetValues("Content-Security-Policy-Report-Only") |> Seq.exactlyOne)
        Assert.StartsWith("default-src 'self'", normal.Headers.GetValues("Content-Security-Policy") |> Seq.exactlyOne)
        let! relaxed = client.GetAsync "/?relaxed=1"
        Assert.Equal("default-src *", relaxed.Headers.GetValues("Content-Security-Policy") |> Seq.exactlyOne)
    }

[<Fact>]
let ``builder: set replaces, add appends, remove drops, value-less directives render bare`` () =
    let p =
        CspPolicyBuilder()
            .Set("script-src", "'self'")
            .Add("script-src", "https://cdn.example")
            .Set("upgrade-insecure-requests")
            .Set("img-src", "'self'")
            .Remove("img-src")
    Assert.Equal("script-src 'self' https://cdn.example; upgrade-insecure-requests", p.Build "n")

[<Fact>]
let ``UseIslandsCsp without AddIslandsCsp fails clearly`` () =
    task {
        let builder = WebApplication.CreateBuilder()
        builder.WebHost.UseTestServer() |> ignore
        let app = builder.Build()
        app.UseIslandsCsp() |> ignore
        app.MapGet("/", Func<IResult>(fun () -> html "x")) |> ignore
        do! app.StartAsync()
        let! e = Assert.ThrowsAsync<System.InvalidOperationException>(fun () -> app.GetTestClient().GetAsync("/") :> Task)
        Assert.Contains("AddIslandsCsp", e.Message)
        do! app.StopAsync()
    }



