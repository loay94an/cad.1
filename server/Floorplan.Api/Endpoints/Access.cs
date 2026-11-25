using Floorplan.Api.Database;
using Microsoft.EntityFrameworkCore;

namespace Floorplan.Api.Endpoints;

public static class Access
{
    /// <summary>The caller's role on a home: owner, editor, viewer, or null when they have no access.</summary>
    public static async Task<(Home? Home, string? Role)> FindAsync(AppDb db, User user, string homeId, CancellationToken ct)
    {
        var home = await db.Homes.FirstOrDefaultAsync(h => h.Id == homeId, ct);
        if (home is null) return (null, null);
        if (home.OwnerId == user.Id) return (home, Roles.Owner);

        var role = await SharesFor(db, user)
            .Where(s => s.HomeId == homeId)
            .Select(s => s.Role)
            .FirstOrDefaultAsync(ct);
        return role is null ? (null, null) : (home, role);
    }

    public static IQueryable<HomeShare> SharesFor(AppDb db, User user) =>
        db.HomeShares.Where(s => s.UserId == user.Id || (user.Email != null && s.Email == user.Email));

    /// <summary>404 for no access (strangers cannot tell the home exists), 403 for too little.</summary>
    public static IResult? Require(string? role, Func<string, bool> allowed) =>
        role is null ? Results.NotFound() : allowed(role) ? null : Results.StatusCode(StatusCodes.Status403Forbidden);
}
