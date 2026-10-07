using System.Security.Claims;
using BlazorIslands;
using IslandsSample;
using IslandsSample.Components;
using IslandsSample.Shared;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

var builder = WebApplication.CreateBuilder(args);

AppModes.Configure(builder.Configuration);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents()
    .AddInteractiveWebAssemblyComponents();

builder.Services.AddBlazorIslands();
builder.Services.AddSingleton<NoteStore>();
builder.Services.AddCascadingAuthenticationState();
builder.Services.AddAuthorization();
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = "/account/login";
        options.UseIslandStatusCodes();
    });

var app = builder.Build();

// Sub-path hosting (Islands:PathBase=/coolapp), as MS Learn describes for apps behind a reverse proxy or IIS sub-app:
// UsePathBase first, <base href> from the request's path base (App.razor). Anything outside the prefix is a 404, as it
// would be behind a proxy that only forwards /coolapp/*, so a URL that escapes the base fails loudly in the tests.
var pathBase = app.Configuration["Islands:PathBase"];
if (!string.IsNullOrEmpty(pathBase))
{
    app.UsePathBase(pathBase);
    app.Use(async (context, next) =>
    {
        if (!context.Request.PathBase.HasValue)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        await next(context);
    });

    // WebApplication adds routing at the start of the pipeline unless the app calls UseRouting itself; routes must be
    // matched after UsePathBase strips the prefix.
    app.UseRouting();
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
}

app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);

// Strict, nonce-based CSP on every response: no 'unsafe-inline', no 'unsafe-eval'.
// Islands:Csp=strict-dynamic switches to the web.dev "strict CSP" shape; the e2e suite runs under both.
var strictDynamic = SampleDevHooks.StrictDynamic = string.Equals(app.Configuration["Islands:Csp"], "strict-dynamic", StringComparison.OrdinalIgnoreCase);
app.UseIslandsCsp(options => options.Policy = (strictDynamic ? CspPolicyBuilder.StrictDynamic() : CspPolicyBuilder.Strict()).AllowWebAssembly());

// Test hooks: artificially slow island bundles, and an optional blazor.web.js built from a local aspnetcore clone.
app.UseSampleDevHooks();

app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode()
    .AddInteractiveWebAssemblyRenderMode()
    .AddAdditionalAssemblies(typeof(IslandsSample.Client.Matrix.MatrixModes).Assembly);

// A cookie-authenticated Web API that TSX islands call with islandFetch/islandJson.
var api = app.MapGroup("/api").WithIslandAntiforgery();
api.MapGet("/me", (ClaimsPrincipal user) => new Me(user.Identity?.IsAuthenticated == true, user.Identity?.Name));
api.MapGet("/notes", (ClaimsPrincipal user, NoteStore store) => store.List(user.Identity!.Name!)).RequireAuthorization();
api.MapPost("/notes", (CreateNoteRequest request, ClaimsPrincipal user, NoteStore store) =>
    string.IsNullOrWhiteSpace(request.Text)
        ? Results.ValidationProblem(new Dictionary<string, string[]> { ["text"] = ["A note needs text."] })
        : Results.Ok(store.Add(user.Identity!.Name!, request.Text, request.Kind))).RequireAuthorization();

app.MapPost("/account/login", async (HttpContext http, [Microsoft.AspNetCore.Mvc.FromForm] string userName, [Microsoft.AspNetCore.Mvc.FromForm] string? returnUrl) =>
{
    var identity = new ClaimsIdentity([new Claim(ClaimTypes.Name, userName)], CookieAuthenticationDefaults.AuthenticationScheme);
    await http.SignInAsync(new ClaimsPrincipal(identity));
    return Results.LocalRedirect(string.IsNullOrEmpty(returnUrl) ? "~/api-demo" : returnUrl);
});
app.MapPost("/account/logout", async (HttpContext http) =>
{
    await http.SignOutAsync();
    return Results.LocalRedirect("~/api-demo");
});

app.Run();

public partial class Program;



