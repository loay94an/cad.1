using System.Security.Cryptography.X509Certificates;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Floorplan.Api.Auth;

/// <summary>
/// How access tokens from the OIDC provider are checked, beyond the signature and issuer that
/// JwtBearer reads from the provider's discovery document.
/// </summary>
public static class OidcTokens
{
    /// <summary>
    /// Sets the decryption keys and the audience rule on <paramref name="p"/>.
    /// <list type="bullet">
    /// <item>Encrypted access tokens (JWE, the OpenIddict default) are decrypted with
    /// <c>Oidc:TokenDecryptionCert:Path</c> (+ <c>:Password</c>), a .pfx with the private key, or with
    /// <c>Oidc:TokenDecryptionKey</c>, a base64 symmetric key.</item>
    /// <item>A token passes the audience check when its <c>aud</c> contains <paramref name="audience"/>,
    /// or when it has no <c>aud</c> at all but was issued to this app (<c>client_id</c> or <c>azp</c> equals
    /// <paramref name="clientId"/>). OpenIddict leaves <c>aud</c> out unless the token has resources.</item>
    /// </list>
    /// </summary>
    public static void Configure(TokenValidationParameters p, IConfiguration config, string? audience, string? clientId)
    {
        p.TokenDecryptionKeys = DecryptionKeys(config).ToList();

        p.ValidateAudience = !string.IsNullOrEmpty(audience) && config.GetValue("Oidc:ValidateAudience", true);
        if (!p.ValidateAudience) return;
        p.ValidAudience = audience;
        p.AudienceValidator = (audiences, token, _) =>
        {
            var list = audiences?.ToList() ?? [];
            if (list.Count > 0) return list.Contains(audience!, StringComparer.Ordinal);
            if (string.IsNullOrEmpty(clientId)) return false;
            var jwt = token as JsonWebToken;
            jwt = jwt?.InnerToken ?? jwt;
            return jwt is not null
                && ((jwt.TryGetPayloadValue("client_id", out string c) && c == clientId)
                    || (jwt.TryGetPayloadValue("azp", out string azp) && azp == clientId));
        };
    }

    static IEnumerable<SecurityKey> DecryptionKeys(IConfiguration config)
    {
        if (config["Oidc:TokenDecryptionCert:Path"] is { Length: > 0 } path)
        {
            var cert = X509CertificateLoader.LoadPkcs12FromFile(path, config["Oidc:TokenDecryptionCert:Password"]);
            if (!cert.HasPrivateKey)
                throw new InvalidOperationException($"Oidc:TokenDecryptionCert ({path}) has no private key.");
            yield return new X509SecurityKey(cert);
        }
        if (config["Oidc:TokenDecryptionKey"] is { Length: > 0 } key)
            yield return new SymmetricSecurityKey(Convert.FromBase64String(key));
    }
}
