// Licensed under the MIT license.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace BlazorIslands;

/// <summary>
/// The JSON conventions shared by island props, island events, the TypeScript generator and (through
/// <c>AddBlazorIslands()</c>) Minimal API bodies: web defaults (camelCase) plus enums as strings, because the generator
/// emits string-literal unions. System.Text.Json handles F# records, options, lists, sets and maps natively.
/// </summary>
public static class IslandJson
{
    /// <summary>Applies the island conventions to existing options, e.g. Minimal API or MVC JSON options.</summary>
    public static void Configure(JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (!options.Converters.Any(c => c is JsonStringEnumConverter))
        {
            options.Converters.Add(new JsonStringEnumConverter());
        }
    }

    /// <summary>Creates a new mutable options instance with the island conventions.</summary>
    public static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Configure(options);
        return options;
    }

    /// <summary>Shared read-only instance.</summary>
    public static JsonSerializerOptions Default { get; } = CreateReadOnly();

    private static JsonSerializerOptions CreateReadOnly()
    {
        var options = CreateOptions();
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }
}

/// <summary>Marks a type (an island's props, or a Web API request/response DTO) for TypeScript generation.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct | AttributeTargets.Interface | AttributeTargets.Enum, AllowMultiple = false)]
public sealed class TypeScriptAttribute : Attribute
{
}
