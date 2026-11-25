using System.Text.Json;
using Floorplan.Api.Auth;
using Floorplan.Api.Database;
using Floorplan.Api.Storage;
using Microsoft.EntityFrameworkCore;

namespace Floorplan.Api.Endpoints;

public sealed record VersionSummaryDto(string Id, string Name, DateTime CreatedAt, bool Auto, string? CreatedBy);

public sealed record VersionDto(string Id, string Name, DateTime CreatedAt, bool Auto, string? CreatedBy, JsonElement Document);

/// <summary>POST body: a name and the whole project JSON. <c>Auto</c>: made by the app, pruned to the newest <see cref="VersionEndpoints.KeepAuto"/>.</summary>
public sealed record CreateVersionRequest(string? Name, JsonElement Document, bool Auto = false);

/// <summary>Named snapshots of a home. Viewers can list and open them; editors and owners can save and delete.</summary>
public static class VersionEndpoints
{
    public const int KeepAuto = 10;

    public static void MapVersions(this RouteGroupBuilder api)
    {
        api.MapGet("/homes/{id}/versions", async (string id, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(id)) return Results.NotFound();
            var user = await current.GetAsync(ct);
            var (home, role) = await Access.FindAsync(db, user, id, ct);
            if (Access.Require(role, _ => true) is { } denied) return denied;

            var rows = await db.HomeVersions.Where(v => v.HomeId == home!.Id)
                .Select(v => new { v.Id, v.Name, v.CreatedAt, v.Auto, By = v.CreatedBy })
                .ToListAsync(ct);
            return Results.Ok(rows
                .OrderByDescending(v => v.CreatedAt)
                .Select(v => new VersionSummaryDto(v.Id, v.Name, v.CreatedAt, v.Auto, v.By is null ? null : HomeEndpoints.OwnerName(v.By))));
        });

        api.MapPost("/homes/{id}/versions", async (string id, CreateVersionRequest body, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(id)) return Results.NotFound();
            var user = await current.GetAsync(ct);
            var (home, role) = await Access.FindAsync(db, user, id, ct);
            if (Access.Require(role, Roles.CanWrite) is { } denied) return denied;
            if (body.Document.ValueKind != JsonValueKind.Object)
                return Results.BadRequest(new { error = "document must be a JSON object" });
            if (body.Document.TryGetProperty("id", out var idEl) && (idEl.ValueKind != JsonValueKind.String || idEl.GetString() != id))
                return Results.BadRequest(new { error = "document.id does not match the home id" });

            var name = body.Name?.Trim() ?? "";
            if (name.Length == 0) return Results.BadRequest(new { error = "name is required" });
            if (name.Length > HomeEndpoints.MaxNameLength) name = name[..HomeEndpoints.MaxNameLength];

            var version = new HomeVersion
            {
                Id = Guid.NewGuid().ToString("N"),
                HomeId = home!.Id,
                Name = name,
                Document = body.Document.GetRawText(),
                Auto = body.Auto,
                CreatedAt = DateTime.UtcNow,
                CreatedById = user.Id,
            };
            db.HomeVersions.Add(version);
            await db.SaveChangesAsync(ct);

            if (body.Auto)
            {
                var old = await db.HomeVersions.Where(v => v.HomeId == home.Id && v.Auto)
                    .OrderByDescending(v => v.CreatedAt)
                    .Skip(KeepAuto)
                    .Select(v => v.Id)
                    .ToListAsync(ct);
                if (old.Count > 0) await db.HomeVersions.Where(v => old.Contains(v.Id)).ExecuteDeleteAsync(ct);
            }

            return Results.Created($"/api/homes/{id}/versions/{version.Id}",
                new VersionSummaryDto(version.Id, version.Name, version.CreatedAt, version.Auto, HomeEndpoints.OwnerName(user)));
        });

        api.MapGet("/homes/{id}/versions/{versionId}", async (string id, string versionId, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(id) || !FileStore.IsValidId(versionId)) return Results.NotFound();
            var user = await current.GetAsync(ct);
            var (home, role) = await Access.FindAsync(db, user, id, ct);
            if (Access.Require(role, _ => true) is { } denied) return denied;

            var v = await db.HomeVersions.Include(x => x.CreatedBy)
                .FirstOrDefaultAsync(x => x.Id == versionId && x.HomeId == home!.Id, ct);
            if (v is null) return Results.NotFound();
            using var doc = JsonDocument.Parse(v.Document);
            return Results.Ok(new VersionDto(v.Id, v.Name, v.CreatedAt, v.Auto,
                v.CreatedBy is null ? null : HomeEndpoints.OwnerName(v.CreatedBy), doc.RootElement.Clone()));
        });

        api.MapDelete("/homes/{id}/versions/{versionId}", async (string id, string versionId, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(id) || !FileStore.IsValidId(versionId)) return Results.NotFound();
            var user = await current.GetAsync(ct);
            var (home, role) = await Access.FindAsync(db, user, id, ct);
            if (Access.Require(role, Roles.CanWrite) is { } denied) return denied;

            var n = await db.HomeVersions.Where(v => v.Id == versionId && v.HomeId == home!.Id).ExecuteDeleteAsync(ct);
            return n == 0 ? Results.NotFound() : Results.NoContent();
        });
    }
}
