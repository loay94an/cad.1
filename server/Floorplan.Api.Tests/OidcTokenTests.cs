using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Floorplan.Api.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Floorplan.Api.Tests;

/// <summary>Access tokens shaped like OpenIddict's: encrypted (JWE), and without <c>aud</c> unless resources are set.</summary>
public sealed class OidcTokenTests : IDisposable
{
    const string Issuer = "https://auth.example.com/";
    readonly RsaSecurityKey signingKey = new(RSA.Create(2048));
    readonly X509Certificate2 encryptionCert;
    readonly string pfxPath = Path.Combine(Path.GetTempPath(), $"floorplan-test-{Guid.NewGuid():N}.pfx");
    readonly byte[] symmetricKey = RandomNumberGenerator.GetBytes(32);

    public OidcTokenTests()
    {
        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest("CN=test encryption", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        File.WriteAllBytes(pfxPath, cert.Export(X509ContentType.Pfx, "pw"));
        encryptionCert = X509CertificateLoader.LoadPkcs12(cert.Export(X509ContentType.Pfx, "pw"), "pw");
    }

    public void Dispose()
    {
        encryptionCert.Dispose();
        File.Delete(pfxPath);
    }

    string Token(EncryptingCredentials? encrypt, string? aud = null, string clientId = "floorplan")
    {
        var claims = new Dictionary<string, object> { ["sub"] = "u1", ["client_id"] = clientId };
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = aud,
            Claims = claims,
            Expires = DateTime.UtcNow.AddMinutes(5),
            SigningCredentials = new SigningCredentials(signingKey, SecurityAlgorithms.RsaSha256),
            EncryptingCredentials = encrypt,
        });
    }

    EncryptingCredentials CertEncryption() => new(new X509SecurityKey(encryptionCert),
        SecurityAlgorithms.RsaOAEP, SecurityAlgorithms.Aes256CbcHmacSha512);

    EncryptingCredentials KeyEncryption() => new(new SymmetricSecurityKey(symmetricKey),
        SecurityAlgorithms.Aes256KW, SecurityAlgorithms.Aes256CbcHmacSha512);

    async Task<bool> Valid(string token, Dictionary<string, string?> settings, string? audience = "floorplan")
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var p = new TokenValidationParameters { ValidIssuer = Issuer, IssuerSigningKey = signingKey };
        OidcTokens.Configure(p, config, audience, "floorplan");
        return (await new JsonWebTokenHandler().ValidateTokenAsync(token, p)).IsValid;
    }

    Dictionary<string, string?> WithCert() => new()
    {
        ["Oidc:TokenDecryptionCert:Path"] = pfxPath,
        ["Oidc:TokenDecryptionCert:Password"] = "pw",
    };

    Dictionary<string, string?> WithKey() => new() { ["Oidc:TokenDecryptionKey"] = Convert.ToBase64String(symmetricKey) };

    [Fact]
    public async Task Token_encrypted_with_a_certificate_is_decrypted() =>
        Assert.True(await Valid(Token(CertEncryption()), WithCert()));

    [Fact]
    public async Task Token_encrypted_with_a_symmetric_key_is_decrypted() =>
        Assert.True(await Valid(Token(KeyEncryption()), WithKey()));

    [Fact]
    public async Task Encrypted_token_without_a_decryption_key_is_refused() =>
        Assert.False(await Valid(Token(CertEncryption()), []));

    [Fact]
    public async Task Token_without_aud_for_another_client_is_refused() =>
        Assert.False(await Valid(Token(null, clientId: "other-app"), []));

    [Fact]
    public async Task Token_with_the_right_aud_passes_and_a_wrong_aud_is_refused()
    {
        Assert.True(await Valid(Token(null, aud: "floorplan"), []));
        Assert.False(await Valid(Token(null, aud: "other-api"), []));
    }

    [Fact]
    public async Task Audience_check_can_be_turned_off() =>
        Assert.True(await Valid(Token(null, aud: "other-api"), new() { ["Oidc:ValidateAudience"] = "false" }));
}
