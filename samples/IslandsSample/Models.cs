using BlazorIslands;
using IslandsSample.Shared;

namespace IslandsSample;

/// <summary>Response of GET /api/me. C# records generate TypeScript interfaces just like F# records.</summary>
[TypeScript]
public sealed record Me(bool IsAuthenticated, string? Name);

/// <summary>Body of POST /api/notes.</summary>
[TypeScript]
public sealed record CreateNoteRequest(string Text, NoteKind Kind);

/// <summary>Props for the htm counter island.</summary>
[TypeScript]
public sealed record CounterProps(int Start, string Label, string? Note);

/// <summary>Props for the Preact TSX todo island.</summary>
[TypeScript]
public sealed record TodoProps(string Title, IReadOnlyList<string> Items);

/// <summary>Props for the React greeting island.</summary>
[TypeScript]
public sealed record GreetingProps(string Name, int Visits);
