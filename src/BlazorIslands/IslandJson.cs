// Licensed under the MIT license.

using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace BlazorIslands;

/// <summary>
/// The JSON conventions shared by island props, island events, the TypeScript generator and (through
/// <c>AddBlazorIslands()</c>) Minimal API bodies: web defaults (camelCase) plus enums as strings, because the generator
/// emits string-literal unions. System.Text.Json handles F# records, options, lists, sets and maps natively.
/// </summary>
/// <remarks>
/// Like Blazor's own JS interop, the defaults use reflection-based metadata (when the app allows it) for props and
/// event details. For fully trim-safe props, pass options whose <see cref="JsonSerializerOptions.TypeInfoResolver"/> is a
/// source-generated <see cref="JsonSerializerContext"/>.
/// </remarks>
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
        if (JsonSerializer.IsReflectionEnabledByDefault)
        {
            options.TypeInfoResolverChain.Add(CreateReflectionResolver());
        }

        Configure(options);
        return options;
    }

    /// <summary>Shared read-only instance.</summary>
    public static JsonSerializerOptions Default { get; } = CreateReadOnly();

    private static JsonSerializerOptions CreateReadOnly()
    {
        var options = CreateOptions();
        options.MakeReadOnly();
        return options;
    }

    /// <summary>Serializes a value by its runtime type, as Blazor does for JS interop arguments.</summary>
    internal static string Serialize(object value, JsonSerializerOptions? options)
        => JsonSerializer.Serialize(value, GetTypeInfo(value.GetType(), options));

    internal static JsonTypeInfo GetTypeInfo(Type type, JsonSerializerOptions? options)
    {
        options ??= Default;
        if (!options.IsReadOnly)
        {
            // What JsonSerializer does on first use of caller-supplied options.
            MakeReadOnlyWithDefaultResolver(options);
        }

        return options.GetTypeInfo(type);
    }

    [UnconditionalSuppressMessage("Trimming", "IL2026", Justification = "Guarded by JsonSerializer.IsReflectionEnabledByDefault, as in Blazor's JSRuntime.")]
    [UnconditionalSuppressMessage("AOT", "IL3050", Justification = "Guarded by JsonSerializer.IsReflectionEnabledByDefault, as in Blazor's JSRuntime.")]
    private static DefaultJsonTypeInfoResolver CreateReflectionResolver() => new();

    [UnconditionalSuppressMessage("Trimming", "IL2026", Justification = "Guarded by JsonSerializer.IsReflectionEnabledByDefault, as in Blazor's JSRuntime.")]
    [UnconditionalSuppressMessage("AOT", "IL3050", Justification = "Guarded by JsonSerializer.IsReflectionEnabledByDefault, as in Blazor's JSRuntime.")]
    private static void MakeReadOnlyWithDefaultResolver(JsonSerializerOptions options)
        => options.MakeReadOnly(populateMissingResolver: JsonSerializer.IsReflectionEnabledByDefault);
}

/// <summary>Marks a type (an island's props, or a Web API request/response DTO) for TypeScript generation.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct | AttributeTargets.Interface | AttributeTargets.Enum, AllowMultiple = false)]
public sealed class TypeScriptAttribute : Attribute
{
}
