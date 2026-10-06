namespace IslandsSample.Shared

open System
open System.Collections.Concurrent
open System.Threading

/// In-memory, per-user note storage used by the Web API that islands call.
type NoteStore() =
    let notes = ConcurrentDictionary<string, ConcurrentQueue<Note>>(StringComparer.OrdinalIgnoreCase)
    let mutable nextId = 0

    member _.List(user: string) : Note list =
        match notes.TryGetValue user with
        | true, q -> q |> Seq.toList
        | _ -> []

    member _.Add(user: string, text: string, kind: NoteKind) : Note =
        if String.IsNullOrWhiteSpace text then invalidArg (nameof text) "A note needs text."
        let note =
            { Id = Interlocked.Increment &nextId
              Text = text.Trim()
              Kind = kind
              Author = user
              CreatedAt = DateTimeOffset.UtcNow }
        notes.GetOrAdd(user, fun _ -> ConcurrentQueue()).Enqueue note
        note
