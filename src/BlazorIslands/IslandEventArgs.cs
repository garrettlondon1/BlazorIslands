// Licensed under the MIT license.

using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using Microsoft.AspNetCore.Components;

namespace BlazorIslands;

/// <summary>
/// Raised when an island calls <c>ctx.emit(name, detail)</c>. Only delivered when the island is inside an
/// interactive render mode (Server, WebAssembly or Auto); static SSR has no event loop to deliver it to.
/// </summary>
public sealed class IslandEventArgs : EventArgs
{
    /// <summary>The event name passed to <c>ctx.emit</c>.</summary>
    public string Name { get; set; } = "";

    /// <summary>The JSON detail passed to <c>ctx.emit</c>, or <see cref="JsonValueKind.Undefined"/> when none was sent.</summary>
    public JsonElement Detail { get; set; }

    /// <summary>Deserializes <see cref="Detail"/> with the island JSON conventions (camelCase, enums as strings).</summary>
    public T? GetDetail<[DynamicallyAccessedMembers(JsonSerialized)] T>(JsonSerializerOptions? options = null)
        => Detail.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? default
            : (T?)Detail.Deserialize(IslandJson.GetTypeInfo(typeof(T), options));

    internal const DynamicallyAccessedMemberTypes JsonSerialized =
        DynamicallyAccessedMemberTypes.PublicConstructors | DynamicallyAccessedMemberTypes.PublicFields | DynamicallyAccessedMemberTypes.PublicProperties;
}

/// <summary>Registers <c>@onislandevent</c> for Razor components.</summary>
[EventHandler("onislandevent", typeof(IslandEventArgs), enableStopPropagation: true, enablePreventDefault: false)]
public static class EventHandlers
{
}


