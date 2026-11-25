namespace Floorplan.Api;

/// <summary>Settings read once at startup (see appsettings.json and server/README.md).</summary>
public sealed class AppOptions
{
    /// <summary>Absolute path holding floorplan.db and one folder per home.</summary>
    public required string DataDir { get; init; }

    /// <summary>Largest file accepted; anything larger gets 413.</summary>
    public long MaxFileBytes { get; init; } = 20L * 1024 * 1024;

    /// <summary>Largest request body for an upload: the file plus room for the multipart form around it.</summary>
    public long MaxUploadBytes => MaxFileBytes + 1024 * 1024;

    public bool AuthEnabled { get; init; } = true;
    public string? Authority { get; init; }
    public string? ClientId { get; init; }
    public string Scopes { get; init; } = "openid profile email";
}
