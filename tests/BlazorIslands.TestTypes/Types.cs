using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorIslands;

namespace BlazorIslands.TestTypes;

public enum Priority
{
    Low,
    High,
    [JsonStringEnumMemberName("urgent!")] Urgent,
}

[TypeScript]
public sealed record Order(
    int Id,
    string Customer,
    string? Notes,
    decimal Total,
    DateTimeOffset PlacedAt,
    Guid Reference,
    int? Discount,
    Priority Priority,
    IReadOnlyList<OrderLine> Lines,
    string?[] Tags,
    List<string> Labels,
    Dictionary<string, int> Counts,
    IReadOnlyDictionary<Priority, string?> ByPriority,
    Address? Shipping,
    Page<OrderLine> FirstPage,
    JsonElement Extra,
    byte[] Signature);

public sealed record OrderLine(string Sku, int Quantity);

public sealed class Address
{
    public string Street { get; set; } = "";
    public string? Line2 { get; set; }

    [JsonPropertyName("zip-code")] public string Zip { get; set; } = "";

    [JsonIgnore] public string Secret { get; set; } = "";

    public string this[int i] => Street;
}

public sealed class Page<T>
{
    public required IReadOnlyList<T> Items { get; init; }
    public T? First { get; init; }
    public int Total { get; init; }
}

public sealed record WithTuple((int, string) Pair);

public sealed record WithObjectKey(Dictionary<Address, int> Map);

public sealed record Node(string Name, IReadOnlyList<Node> Children, Node? Parent);
