namespace Floorplan.Api.Database;

/// <summary>A person who signed in through the OIDC provider. <see cref="Id"/> is the token's <c>sub</c>.</summary>
public sealed class User
{
    public required string Id { get; set; }
    public string? Name { get; set; }
    /// <summary>Lower-case. Only set when the provider does not say it is unverified.</summary>
    public string? Email { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>A saved project. <see cref="Document"/> is the client's project JSON, stored as-is.</summary>
public sealed class Home
{
    public required string Id { get; set; }
    public required string OwnerId { get; set; }
    public User? Owner { get; set; }
    public required string Name { get; set; }
    public required string Document { get; set; }
    /// <summary>Starts at 1 and goes up by one on every save. Used for optimistic concurrency.</summary>
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public static class Roles
{
    public const string Owner = "owner";
    public const string Editor = "editor";
    public const string Viewer = "viewer";

    public static bool IsShareRole(string? role) => role is Editor or Viewer;
    public static bool CanWrite(string? role) => role is Owner or Editor;
}

/// <summary>Access to a home for another user, by email. <see cref="UserId"/> is filled once that user is known.</summary>
public sealed class HomeShare
{
    public int Id { get; set; }
    public required string HomeId { get; set; }
    /// <summary>Lower-case.</summary>
    public required string Email { get; set; }
    public string? UserId { get; set; }
    public required string Role { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>A picture or document attached to a room. <see cref="Path"/> is relative to the data directory.</summary>
public sealed class StoredFile
{
    public required string Id { get; set; }
    public required string HomeId { get; set; }
    public required string RoomId { get; set; }
    public required string Name { get; set; }
    public required string Mime { get; set; }
    public long Size { get; set; }
    public required string Path { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// A named snapshot of a home ("Current", "After renovation"): a full copy of the project JSON at that moment.
/// Photos and documents are not copied; the version points to the same files. <see cref="Auto"/> versions are
/// made by the app (before a restore) and only the newest few are kept.
/// </summary>
public sealed class HomeVersion
{
    public required string Id { get; set; }
    public required string HomeId { get; set; }
    public required string Name { get; set; }
    public required string Document { get; set; }
    public bool Auto { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
}
