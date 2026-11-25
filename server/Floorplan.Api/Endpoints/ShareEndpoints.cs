using Floorplan.Api.Auth;
using Floorplan.Api.Database;
using Floorplan.Api.Storage;
using Microsoft.EntityFrameworkCore;

namespace Floorplan.Api.Endpoints;

public sealed record ShareDto(string Email, string Role, string? UserId, string? Name, DateTime CreatedAt);

public sealed record ShareRequest(string? Email, string? Role);

/// <summary>Who else can open a home. Owner only. Shares are by email, so they work before that person first signs in.</summary>
public static class ShareEndpoints
{
    public static void MapShares(this RouteGroupBuilder api)
    {
        api.MapGet("/homes/{id}/shares", async (string id, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (await OwnedHomeAsync(id, current, db, ct) is { Error: { } error }) return error;
            var shares = await (from s in db.HomeShares
                                where s.HomeId == id
                                join u in db.Users on s.UserId equals u.Id into users
                                from u in users.DefaultIfEmpty()
                                orderby s.Email
                                select new ShareDto(s.Email, s.Role, s.UserId, u == null ? null : u.Name, s.CreatedAt))
                .ToListAsync(ct);
            return Results.Ok(shares);
        });

        // Adds a share, or changes the role of an existing one for the same email.
        api.MapPost("/homes/{id}/shares", async (string id, ShareRequest body, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            var (owner, error) = await OwnedHomeAsync(id, current, db, ct);
            if (error is not null) return error;

            var email = string.IsNullOrWhiteSpace(body.Email) ? null : CurrentUser.NormalizeEmail(body.Email);
            var at = email?.IndexOf('@') ?? -1;
            if (email is null || email.Length > 320 || at <= 0 || at == email.Length - 1)
                return Results.BadRequest(new { error = "a valid email is required" });
            var role = body.Role?.Trim().ToLowerInvariant();
            if (!Roles.IsShareRole(role))
                return Results.BadRequest(new { error = "role must be 'viewer' or 'editor'" });
            if (email == owner!.Email)
                return Results.BadRequest(new { error = "You already own this home." });

            var share = await db.HomeShares.FirstOrDefaultAsync(s => s.HomeId == id && s.Email == email, ct);
            var userId = await db.Users.Where(u => u.Email == email).Select(u => u.Id).FirstOrDefaultAsync(ct);
            if (share is null)
            {
                share = new HomeShare { HomeId = id, Email = email, Role = role!, UserId = userId, CreatedAt = DateTime.UtcNow };
                db.HomeShares.Add(share);
            }
            else
            {
                share.Role = role!;
                share.UserId ??= userId;
            }
            await db.SaveChangesAsync(ct);
            var name = userId is null ? null : await db.Users.Where(u => u.Id == userId).Select(u => u.Name).FirstOrDefaultAsync(ct);
            return Results.Ok(new ShareDto(share.Email, share.Role, share.UserId, name, share.CreatedAt));
        });

        // DELETE /api/homes/{id}/shares/bob@example.com (URL-encode the email).
        api.MapDelete("/homes/{id}/shares/{email}", async (string id, string email, CurrentUser current, AppDb db, CancellationToken ct) =>
        {
            if (await OwnedHomeAsync(id, current, db, ct) is { Error: { } error }) return error;
            if (string.IsNullOrWhiteSpace(email)) return Results.BadRequest(new { error = "email is required" });
            var normalized = CurrentUser.NormalizeEmail(email);
            var removed = await db.HomeShares.Where(s => s.HomeId == id && s.Email == normalized).ExecuteDeleteAsync(ct);
            return removed == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static async Task<(User? Owner, IResult? Error)> OwnedHomeAsync(string id, CurrentUser current, AppDb db, CancellationToken ct)
    {
        if (!FileStore.IsValidId(id)) return (null, Results.NotFound());
        var user = await current.GetAsync(ct);
        var (_, role) = await Access.FindAsync(db, user, id, ct);
        return (user, Access.Require(role, r => r == Roles.Owner));
    }
}
