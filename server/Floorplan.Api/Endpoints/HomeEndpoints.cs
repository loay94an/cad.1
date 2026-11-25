using System.Text.Json;
using Floorplan.Api.Auth;
using Floorplan.Api.Database;
using Floorplan.Api.Storage;
using Microsoft.EntityFrameworkCore;

namespace Floorplan.Api.Endpoints;

public sealed record UserDto(string Id, string? Name, string? Email);

public sealed record HomeSummaryDto(string Id, string Name, string Role, int Version, DateTime UpdatedAt, string OwnerName, UserDto Owner);

public sealed record HomeDto(string Id, string Name, string Role, int Version, DateTime UpdatedAt, string OwnerName, UserDto Owner, JsonElement Document);

public sealed record SavedDto(string Id, int Version, DateTime UpdatedAt);

/// <summary>409 body. <c>Version</c> is the current version on the server (<c>CurrentVersion</c> is the same).</summary>
public sealed record ConflictDto(string Error, int Version, int CurrentVersion, DateTime UpdatedAt);

/// <summary>POST body. The id is made by the client. <c>Name</c> falls back to <c>document.name</c>.</summary>
public sealed record CreateHomeRequest(string? Id, string? Name, JsonElement Document);

/// <summary>PUT body: the version the client last saw, the name, and the whole project JSON.</summary>
public sealed record UpdateHomeRequest(int Version, string? Name, JsonElement Document);

public static class HomeEndpoints
{
    public const int MaxNameLength = 200;

    public static void MapHomes(this RouteGroupBuilder api)
    {
        api.MapGet("/me", async (CurrentUser current, CancellationToken ct) =>
        {
            var u = await current.GetAsync(ct);
            return Results.Ok(ToDto(u));
        });

        api.MapGet("/homes", async (CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            var user = await current.GetAsync(ct);
            var owned = await db.Homes.Where(h => h.OwnerId == user.Id)
                .Select(h => new { Home = h, Role = Roles.Owner, Owner = h.Owner! })
                .ToListAsync(ct);
            var shared = await (from s in Access.SharesFor(db, user)
                                join h in db.Homes on s.HomeId equals h.Id
                                where h.OwnerId != user.Id
                                select new { Home = h, s.Role, Owner = h.Owner! }).ToListAsync(ct);
            return Results.Ok(owned.Concat(shared)
                .DistinctBy(x => x.Home.Id)
                .OrderByDescending(x => x.Home.UpdatedAt)
                .Select(x => Summary(x.Home, x.Role, x.Owner)));
        });

        // Body: { id, name, document }. 409 if the id is taken.
        api.MapPost("/homes", async (CreateHomeRequest body, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(body.Id))
                return Results.BadRequest(new { error = "id must be 1-64 letters, digits, '-' or '_'" });
            var id = body.Id!;
            if (Validate(body.Document, id) is { } bad) return bad;
            var user = await current.GetAsync(ct);
            if (await db.Homes.AnyAsync(h => h.Id == id, ct))
                return Results.Conflict(new { error = "exists", message = "A home with this id already exists; use PUT." });

            var home = Create(id, user, body.Name, body.Document);
            db.Homes.Add(home);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                return Results.Conflict(new { error = "exists" });
            }
            return Results.Created($"/api/homes/{id}", Summary(home, Roles.Owner, user));
        });

        api.MapGet("/homes/{id}", async (string id, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(id)) return Results.NotFound();
            var user = await current.GetAsync(ct);
            var (home, role) = await Access.FindAsync(db, user, id, ct);
            if (home is null || role is null) return Results.NotFound();
            var owner = await db.Users.FirstAsync(u => u.Id == home.OwnerId, ct);
            using var doc = JsonDocument.Parse(home.Document);
            return Results.Ok(new HomeDto(home.Id, home.Name, role, home.Version, home.UpdatedAt,
                OwnerName(owner), ToDto(owner), doc.RootElement.Clone()));
        });

        // Body: { name, document, version }. "version" must be the one the client last loaded; a stale
        // one gets 409 { version: current }. Version 0 on an unused id creates the home (201).
        api.MapPut("/homes/{id}", async (string id, UpdateHomeRequest body, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(id)) return Results.NotFound();
            if (Validate(body.Document, id) is { } bad) return bad;
            var user = await current.GetAsync(ct);
            var (home, role) = await Access.FindAsync(db, user, id, ct);

            if (home is null)
            {
                if (body.Version != 0 || await db.Homes.AnyAsync(h => h.Id == id, ct)) return Results.NotFound();
                home = Create(id, user, body.Name, body.Document);
                db.Homes.Add(home);
                try
                {
                    await db.SaveChangesAsync(ct);
                }
                catch (DbUpdateException)
                {
                    return Results.Conflict(new { error = "exists" });
                }
                return Results.Created($"/api/homes/{id}", new SavedDto(home.Id, home.Version, home.UpdatedAt));
            }

            if (Access.Require(role, Roles.CanWrite) is { } denied) return denied;
            if (body.Version != home.Version)
                return Results.Conflict(new ConflictDto("version_conflict", home.Version, home.Version, home.UpdatedAt));

            home.Document = body.Document.GetRawText();
            home.Name = NameOf(body.Name, body.Document);
            home.Version++;
            home.UpdatedAt = DateTime.UtcNow;
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                // Someone else saved between our read and our write.
                var latest = await db.Homes.AsNoTracking().FirstAsync(h => h.Id == id, ct);
                return Results.Conflict(new ConflictDto("version_conflict", latest.Version, latest.Version, latest.UpdatedAt));
            }
            return Results.Ok(new SavedDto(home.Id, home.Version, home.UpdatedAt));
        });

        api.MapDelete("/homes/{id}", async (string id, CurrentUser current, AppDb db, FileStore store, CancellationToken ct) =>
        {
            if (!FileStore.IsValidId(id)) return Results.NotFound();
            var user = await current.GetAsync(ct);
            var (home, role) = await Access.FindAsync(db, user, id, ct);
            if (Access.Require(role, r => r == Roles.Owner) is { } denied) return denied;

            // Shares and file rows go with it (ON DELETE CASCADE), then the folder on disk.
            await db.Homes.Where(h => h.Id == home!.Id).ExecuteDeleteAsync(ct);
            store.DeleteHome(home!.Id);
            return Results.NoContent();
        });
    }

    public static UserDto ToDto(User u) => new(u.Id, u.Name, u.Email);

    public static string OwnerName(User u) => u.Name ?? u.Email ?? u.Id;

    private static HomeSummaryDto Summary(Home h, string role, User owner) =>
        new(h.Id, h.Name, role, h.Version, h.UpdatedAt, OwnerName(owner), ToDto(owner));

    private static Home Create(string id, User owner, string? name, JsonElement document)
    {
        var now = DateTime.UtcNow;
        return new Home
        {
            Id = id,
            OwnerId = owner.Id,
            Name = NameOf(name, document),
            Document = document.GetRawText(),
            Version = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    /// <summary>The document must be a JSON object; if it carries an "id", that must be the home id.</summary>
    private static IResult? Validate(JsonElement document, string id)
    {
        if (document.ValueKind != JsonValueKind.Object)
            return Results.BadRequest(new { error = "document must be a JSON object" });
        if (document.TryGetProperty("id", out var idEl) && (idEl.ValueKind != JsonValueKind.String || idEl.GetString() != id))
            return Results.BadRequest(new { error = "document.id does not match the home id" });
        return null;
    }

    /// <summary>The given name, else document.name, else "Untitled".</summary>
    private static string NameOf(string? given, JsonElement document)
    {
        var name = given?.Trim() ?? "";
        if (name.Length == 0 && document.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String)
            name = n.GetString()!.Trim();
        if (name.Length == 0) name = "Untitled";
        return name.Length <= MaxNameLength ? name : name[..MaxNameLength];
    }
}
