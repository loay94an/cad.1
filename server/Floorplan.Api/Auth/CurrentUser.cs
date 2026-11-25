using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using Floorplan.Api.Database;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Floorplan.Api.Auth;

public static class UserClaims
{
    public const string Subject = "sub";
    public const string Name = "name";
    public const string PreferredUsername = "preferred_username";
    public const string Email = "email";
    public const string EmailVerified = "email_verified";
}

/// <summary>
/// The signed-in user as a row in Users. Created on the first request from the token's claims;
/// name and email are refreshed when the token carries newer values. When the access token has no
/// email (some providers only put it in the ID token), the provider's userinfo endpoint is asked once.
/// </summary>
public sealed class CurrentUser(
    IHttpContextAccessor http,
    AppDb db,
    AppOptions app,
    IHttpClientFactory httpClients,
    IOptionsMonitor<JwtBearerOptions> jwtOptions,
    ILogger<CurrentUser> log)
{
    private User? _user;

    public async Task<User> GetAsync(CancellationToken ct = default)
    {
        if (_user is not null) return _user;

        var principal = http.HttpContext?.User ?? throw new InvalidOperationException("No HTTP context.");
        var sub = principal.FindFirstValue(UserClaims.Subject) ?? principal.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new InvalidOperationException("The token has no 'sub' claim.");
        var name = principal.FindFirstValue(UserClaims.Name) ?? principal.FindFirstValue(UserClaims.PreferredUsername);
        var email = VerifiedEmail(principal.FindFirstValue(UserClaims.Email), principal.FindFirstValue(UserClaims.EmailVerified));

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == sub, ct);

        if (email is null && app.AuthEnabled && (user is null || user.Email is null))
        {
            var info = await FetchUserInfoAsync(ct);
            if (info is not null)
            {
                name ??= info.Value.Name;
                email = info.Value.Email;
            }
        }

        if (user is null)
        {
            user = new User { Id = sub, Name = Trim(name, 255), Email = email, CreatedAt = DateTime.UtcNow };
            db.Users.Add(user);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // Another request for the same new user won the race.
                db.Entry(user).State = EntityState.Detached;
                user = await db.Users.FirstAsync(u => u.Id == sub, ct);
            }
        }
        else
        {
            var changed = false;
            if (name is not null && user.Name != Trim(name, 255)) { user.Name = Trim(name, 255); changed = true; }
            if (email is not null && user.Email != email) { user.Email = email; changed = true; }
            if (changed) await db.SaveChangesAsync(ct);
        }

        if (user.Email is not null)
        {
            // Shares made by email before this user first signed in.
            await db.HomeShares
                .Where(s => s.Email == user.Email && s.UserId == null)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.UserId, user.Id), ct);
        }

        return _user = user;
    }

    /// <summary>Only trust an email for sharing when the provider did not say it is unverified.</summary>
    internal static string? VerifiedEmail(string? email, string? verified)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        if (verified is not null && !string.Equals(verified, "true", StringComparison.OrdinalIgnoreCase)) return null;
        return NormalizeEmail(email);
    }

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static string? Trim(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];

    private async Task<(string? Name, string? Email)?> FetchUserInfoAsync(CancellationToken ct)
    {
        try
        {
            var ctx = http.HttpContext!;
            var auth = ctx.Request.Headers.Authorization.ToString();
            if (!auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;

            var options = jwtOptions.Get(JwtBearerDefaults.AuthenticationScheme);
            if (options.ConfigurationManager is null) return null;
            var config = await options.ConfigurationManager.GetConfigurationAsync(ct);
            if (string.IsNullOrEmpty(config.UserInfoEndpoint)) return null;

            using var req = new HttpRequestMessage(HttpMethod.Get, config.UserInfoEndpoint);
            req.Headers.Authorization = AuthenticationHeaderValue.Parse(auth);
            using var res = await httpClients.CreateClient("oidc").SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return null;

            using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var root = doc.RootElement;
            string? Str(string key) => root.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            string? verified = root.TryGetProperty(UserClaims.EmailVerified, out var ev)
                ? ev.ValueKind switch { JsonValueKind.True => "true", JsonValueKind.False => "false", JsonValueKind.String => ev.GetString(), _ => null }
                : null;
            return (Str(UserClaims.Name) ?? Str(UserClaims.PreferredUsername), VerifiedEmail(Str(UserClaims.Email), verified));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Could not read the OIDC userinfo endpoint.");
            return null;
        }
    }
}
