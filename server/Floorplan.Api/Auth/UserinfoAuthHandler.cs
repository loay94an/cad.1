using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Floorplan.Api.Auth;

/// <summary>
/// For access tokens the API cannot read itself: encrypted (JWE, the OpenIddict default) or opaque.
/// The token is sent to the provider's userinfo endpoint. The provider answers 200 with the user's
/// claims only for a valid token, so that both checks the token and says who it belongs to.
/// Answers are cached per token for a few minutes, so not every API call goes to the provider.
/// Unlike a JWT, this cannot check which app the token was issued to.
/// </summary>
public sealed class UserinfoAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IOptionsMonitor<JwtBearerOptions> jwtOptions,
    IHttpClientFactory httpClients,
    IMemoryCache cache,
    IConfiguration config) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Userinfo";

    /// <summary>The scheme that reads the token of this request: JwtBearer for a JWT it can verify, otherwise this one.</summary>
    public static string SelectScheme(HttpContext ctx, bool canDecrypt, bool userinfoAllowed)
    {
        var token = BearerToken(ctx.Request);
        if (token is null || !userinfoAllowed) return JwtBearerDefaults.AuthenticationScheme;
        var parts = token.Count(c => c == '.') + 1;
        return parts == 3 || (parts == 5 && canDecrypt) ? JwtBearerDefaults.AuthenticationScheme : SchemeName;
    }

    static string? BearerToken(HttpRequest req)
    {
        var auth = req.Headers.Authorization.ToString();
        return auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) && auth.Length > 7 ? auth[7..].Trim() : null;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = BearerToken(Request);
        if (token is null) return AuthenticateResult.NoResult();

        var key = "userinfo:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        if (cache.TryGetValue(key, out ClaimsPrincipal? cached))
            return cached is null ? AuthenticateResult.Fail("Access token refused by the userinfo endpoint (cached).") : Success(cached);

        ClaimsPrincipal? principal;
        try
        {
            principal = await AskProviderAsync(token, Context.RequestAborted);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Logger.LogWarning(ex, "Could not reach the OIDC userinfo endpoint.");
            return AuthenticateResult.Fail("The OIDC userinfo endpoint could not be reached.");
        }

        var seconds = config.GetValue("Oidc:UserinfoCacheSeconds", 300);
        cache.Set(key, principal, TimeSpan.FromSeconds(principal is null ? Math.Min(seconds, 30) : seconds));
        if (principal is null)
        {
            Logger.LogWarning("Access token refused: the userinfo endpoint did not accept it.");
            return AuthenticateResult.Fail("Access token refused by the userinfo endpoint.");
        }
        return Success(principal);
    }

    AuthenticateResult Success(ClaimsPrincipal p) => AuthenticateResult.Success(new AuthenticationTicket(p, SchemeName));

    async Task<ClaimsPrincipal?> AskProviderAsync(string token, CancellationToken ct)
    {
        var jwt = jwtOptions.Get(JwtBearerDefaults.AuthenticationScheme);
        var discovery = await jwt.ConfigurationManager!.GetConfigurationAsync(ct);
        if (string.IsNullOrEmpty(discovery.UserInfoEndpoint))
            throw new InvalidOperationException("The provider's discovery document has no userinfo_endpoint.");

        using var req = new HttpRequestMessage(HttpMethod.Get, discovery.UserInfoEndpoint);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var res = await httpClients.CreateClient("oidc").SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;

        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return ToPrincipal(doc.RootElement);
    }

    /// <summary>The userinfo answer as claims; null without a <c>sub</c>.</summary>
    internal static ClaimsPrincipal? ToPrincipal(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        var claims = new List<Claim>();
        foreach (var name in new[] { UserClaims.Subject, UserClaims.Name, UserClaims.PreferredUsername, UserClaims.Email, UserClaims.EmailVerified })
        {
            if (!root.TryGetProperty(name, out var v)) continue;
            var value = v.ValueKind switch
            {
                JsonValueKind.String => v.GetString(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                JsonValueKind.Number => v.GetRawText(),
                _ => null,
            };
            if (!string.IsNullOrEmpty(value)) claims.Add(new Claim(name, value));
        }
        if (!claims.Exists(c => c.Type == UserClaims.Subject)) return null;
        return new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName, UserClaims.Name, "role"));
    }
}
