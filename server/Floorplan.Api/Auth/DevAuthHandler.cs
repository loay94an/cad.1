using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Floorplan.Api.Auth;

/// <summary>
/// Development only (Auth:Enabled = false): every request is signed in as "dev", or as the
/// name in the X-Dev-User header (e.g. alice, bob) with email &lt;name&gt;@dev.local.
/// </summary>
public sealed partial class DevAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Dev";
    public const string HeaderName = "X-Dev-User";

    /// <summary>Suggested users, listed by /api/config. Any name matching the pattern works.</summary>
    public static readonly string[] DevUsers = ["dev", "alice", "bob"];

    [GeneratedRegex("^[a-z0-9._-]{1,32}$")]
    private static partial Regex ValidName();

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var name = Request.Headers[HeaderName].ToString().Trim().ToLowerInvariant();
        if (name.Length == 0) name = "dev";
        if (!ValidName().IsMatch(name))
            return Task.FromResult(AuthenticateResult.Fail($"{HeaderName} must match [a-z0-9._-]{{1,32}}."));

        var identity = new ClaimsIdentity(
            [
                new Claim(UserClaims.Subject, name),
                new Claim(UserClaims.Name, name),
                new Claim(UserClaims.Email, $"{name}@dev.local"),
            ],
            SchemeName, UserClaims.Name, "role");
        return Task.FromResult(AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }
}
