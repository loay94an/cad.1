using System.Text.RegularExpressions;

namespace Floorplan.Api.Storage;

/// <summary>
/// Files live at {DataDir}/{homeId}/{roomId}/{fileId}.{ext}. Every segment is checked against a strict
/// pattern (letters, digits, '-' and '_', no dots), and the final path is checked to stay inside DataDir.
/// </summary>
public sealed partial class FileStore(AppOptions options)
{
    private readonly string _root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.DataDir));

    public string Root => _root;

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex IdPattern();

    [GeneratedRegex("^[a-z0-9]{1,10}$")]
    private static partial Regex ExtPattern();

    public static bool IsValidId(string? id) => id is not null && IdPattern().IsMatch(id);

    /// <summary>Picks a safe extension: from the file name, else from the MIME type, else "bin".</summary>
    public static string ExtensionFor(string? fileName, string? mime)
    {
        var ext = Path.GetExtension(fileName ?? "").TrimStart('.').ToLowerInvariant();
        if (ExtPattern().IsMatch(ext)) return ext;
        return mime?.ToLowerInvariant() switch
        {
            "image/jpeg" => "jpg",
            "image/png" => "png",
            "image/webp" => "webp",
            "image/gif" => "gif",
            "image/heic" => "heic",
            "application/pdf" => "pdf",
            "text/plain" => "txt",
            _ => "bin",
        };
    }

    public static string RelativePath(string homeId, string roomId, string fileId, string ext)
    {
        if (!IsValidId(homeId) || !IsValidId(roomId) || !IsValidId(fileId))
            throw new ArgumentException("Invalid id.");
        if (!ExtPattern().IsMatch(ext)) throw new ArgumentException("Invalid extension.", nameof(ext));
        return $"{homeId}/{roomId}/{fileId}.{ext}";
    }

    /// <summary>Absolute path for a stored relative path; throws if it would leave the data directory.</summary>
    public string FullPath(string relativePath)
    {
        var full = Path.GetFullPath(Path.Combine(_root, relativePath));
        if (!full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidOperationException("Path escapes the data directory.");
        return full;
    }

    public string HomeDir(string homeId)
    {
        if (!IsValidId(homeId)) throw new ArgumentException("Invalid id.", nameof(homeId));
        return FullPath(homeId);
    }

    public async Task SaveAsync(string relativePath, Stream content, CancellationToken ct)
    {
        var full = FullPath(relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        var tmp = full + ".uploading";
        await using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            await content.CopyToAsync(fs, ct);
        File.Move(tmp, full, overwrite: true);
    }

    public void Delete(string relativePath)
    {
        var full = FullPath(relativePath);
        if (File.Exists(full)) File.Delete(full);
    }

    public void DeleteHome(string homeId)
    {
        var dir = HomeDir(homeId);
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
    }
}
