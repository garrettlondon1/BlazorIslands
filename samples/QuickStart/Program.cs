using BlazorIslands;
using QuickStart.Components;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

// 1. Islands: CSP nonce, antiforgery for islandFetch, JSON conventions.
builder.Services.AddBlazorIslands();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

// 2. A strict Content-Security-Policy: no 'unsafe-inline', no 'unsafe-eval'. Everything below works under it.
app.UseIslandsCsp();

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
