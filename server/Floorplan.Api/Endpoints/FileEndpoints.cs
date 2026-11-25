using System.Net.Mime;
using Floorplan.Api.Auth;
using Floorplan.Api.Database;
using Floorplan.Api.Storage;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace Floorplan.Api.Endpoints;

public sealed record FileDto(string Id, string HomeId, string RoomId, string Name, string Mime, long Size, DateTime CreatedAt);

public static class FileEndpoints
{
    /// <summary>Types the browser may show inline. Everything else is served as a download.</summary>
    private static readonly HashSet<string> InlineTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/avif", "application/pdf", "text/plain",
    };

    public static void MapFiles(this RouteGroupBuilder api, AppOptions options)
    {
        // Multipart form: "file" (required) and "id" (optional; the client's own file id, else one is made).
        // Uploading again with the same id replaces the file.
        api.MapPost("/homes/{id}/rooms/{roomId}/files", async (
                string id, string roomId, HttpRequest request, CurrentUser current, AppDb db, FileStore store,
                CancellationToken ct) =>
            {
                if (!FileStore.IsValidId(id)) return Results.NotFound();
                if (!FileStore.IsValidId(roomId)) return Results.BadRequest(new { error = "invalid room id" });
                var user = await current.GetAsync(ct);
                var (home, role) = await Access.FindAsync(db, user, id, ct);
                if (Access.Require(role, Roles.CanWrite) is { } denied) return denied;

                if (!request.HasFormContentType) return Results.BadRequest(new { error = "expected multipart/form-data" });
                var form = await request.ReadFormAsync(ct);
                var upload = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
                if (upload is null) return Results.BadRequest(new { error = "no file in the form (field 'file')" });

                var fileId = form["id"].ToString();
                if (fileId.Length == 0) fileId = Guid.NewGuid().ToString("N");
                if (!FileStore.IsValidId(fileId)) return Results.BadRequest(new { error = "invalid file id" });

                var existing = await db.Files.FirstOrDefaultAsync(f => f.Id == fileId, ct);
                if (existing is not null && existing.HomeId != home!.Id)
                    return Results.Conflict(new { error = "file id is used by another home" });

                var name = SafeName(upload.FileName);
                var mime = string.IsNullOrWhiteSpace(upload.ContentType) ? MediaTypeNames.Application.Octet : upload.ContentType;
                // The app shrinks photos on the phone before uploading, so this only stops very large files.
                if (upload.Length > options.MaxFileBytes)
                    return TooLarge($"Files can be at most {options.MaxFileBytes / (1024 * 1024)} MiB.");
                var size = upload.Length;
                var relative = FileStore.RelativePath(home!.Id, roomId, fileId, FileStore.ExtensionFor(name, mime));
                await using (var input = upload.OpenReadStream())
                    await store.SaveAsync(relative, input, ct);

                if (existing is null)
                {
                    existing = new StoredFile
                    {
                        Id = fileId, HomeId = home.Id, RoomId = roomId, Name = name, Mime = mime, Size = size,
                        Path = relative, CreatedAt = DateTime.UtcNow,
                    };
                    db.Files.Add(existing);
                }
                else
                {
                    if (existing.Path != relative) store.Delete(existing.Path);
                    existing.RoomId = roomId;
                    existing.Name = name;
                    existing.Mime = mime;
                    existing.Size = size;
                    existing.Path = relative;
                }
                await db.SaveChangesAsync(ct);
                return Results.Ok(ToDto(existing));
            })
            .WithMetadata(new RequestSizeLimitAttribute(options.MaxUploadBytes))
            .WithFormOptions(multipartBodyLengthLimit: options.MaxUploadBytes);

        api.MapGet("/homes/{id}/files", async (string id, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(id)) return Results.NotFound();
            var user = await current.GetAsync(ct);
            var (_, role) = await Access.FindAsync(db, user, id, ct);
            if (role is null) return Results.NotFound();
            var files = await db.Files.Where(f => f.HomeId == id).OrderBy(f => f.CreatedAt).ToListAsync(ct);
            return Results.Ok(files.Select(f => ToDto(f)));
        });

        api.MapGet("/files/{fileId}", async (string fileId, HttpContext http, CurrentUser current, AppDb db, FileStore store, CancellationToken ct) =>
        {
            var (file, role) = await FindFileAsync(fileId, current, db, ct);
            if (file is null || role is null) return Results.NotFound();
            var path = store.FullPath(file.Path);
            if (!File.Exists(path)) return Results.NotFound();

            // Uploaded HTML or SVG must never run as this site: sandbox it and do not let browsers sniff.
            http.Response.Headers[HeaderNames.ContentSecurityPolicy] = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
            http.Response.Headers[HeaderNames.XContentTypeOptions] = "nosniff";
            var inline = InlineTypes.Contains(file.Mime);
            var disposition = new ContentDispositionHeaderValue(inline ? "inline" : "attachment");
            disposition.SetHttpFileName(file.Name);
            http.Response.Headers[HeaderNames.ContentDisposition] = disposition.ToString();
            http.Response.Headers[HeaderNames.CacheControl] = "private, max-age=3600";
            return Results.File(path, inline ? file.Mime : MediaTypeNames.Application.Octet, enableRangeProcessing: true);
        });

        api.MapDelete("/files/{fileId}", async (string fileId, CurrentUser current, AppDb db, FileStore store, CancellationToken ct) =>
        {
            var (file, role) = await FindFileAsync(fileId, current, db, ct);
            if (Access.Require(role, Roles.CanWrite) is { } denied) return denied;
            db.Files.Remove(file!);
            await db.SaveChangesAsync(ct);
            store.Delete(file!.Path);
            return Results.NoContent();
        });
    }

    private static async Task<(StoredFile? File, string? Role)> FindFileAsync(string fileId, CurrentUser current, AppDb db, CancellationToken ct)
    {
        if (!FileStore.IsValidId(fileId)) return (null, null);
        var file = await db.Files.FirstOrDefaultAsync(f => f.Id == fileId, ct);
        if (file is null) return (null, null);
        var user = await current.GetAsync(ct);
        var (_, role) = await Access.FindAsync(db, user, file.HomeId, ct);
        return role is null ? (null, null) : (file, role);
    }

    private static FileDto ToDto(StoredFile f) =>
        new(f.Id, f.HomeId, f.RoomId, f.Name, f.Mime, f.Size, f.CreatedAt);

    private static IResult TooLarge(string message) =>
        Results.Json(new { error = "too_large", message }, statusCode: StatusCodes.Status413PayloadTooLarge);

    /// <summary>The display name only: no directories, no control characters, at most 255 characters.</summary>
    private static string SafeName(string? fileName)
    {
        var name = Path.GetFileName((fileName ?? "").Replace('\\', '/'));
        name = new string(name.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (name.Length == 0) name = "file";
        return name.Length <= 255 ? name : name[^255..];
    }
}
