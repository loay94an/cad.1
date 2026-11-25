using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Floorplan.Api.Auth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace Floorplan.Api.Tests;

/// <summary>Encrypted or opaque access tokens are checked at the provider's userinfo endpoint (a stub here).</summary>
public sealed class UserinfoTests : IClassFixture<UserinfoTests.Factory>
{
    // Shaped like a JWE (five parts) that the API has no key for.
    const string GoodToken = "eyJhbGciOiJSU0EtT0FFUCJ9.key.iv.ciphertext.tag";
    const string BadToken = "eyJhbGciOiJSU0EtT0FFUCJ9.key.iv.forged.tag";

    readonly Factory factory;
    public UserinfoTests(Factory factory) => this.factory = factory;

    HttpClient With(string token)
    {
        var c = factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Token_accepted_by_userinfo_signs_in_and_is_cached()
    {
        var before = factory.Userinfo.Calls;
        var me = await With(GoodToken).GetFromJsonAsync<Me>("/api/me");
        Assert.Equal("carol", me!.Id);
        Assert.Equal("Carol", me.Name);
        Assert.Equal("carol@example.com", me.Email);

        var res = await With(GoodToken).GetAsync("/api/homes");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(before + 1, factory.Userinfo.Calls);
    }

    [Fact]
    public async Task Token_refused_by_userinfo_gets_401()
    {
        var res = await With(BadToken).GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task No_token_gets_401() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/me")).StatusCode);

    [Theory]
    [InlineData("a.b.c", false, JwtBearerDefaults.AuthenticationScheme)]
    [InlineData("a.b.c.d.e", true, JwtBearerDefaults.AuthenticationScheme)]
    [InlineData("a.b.c.d.e", false, UserinfoAuthHandler.SchemeName)]
    [InlineData("opaque-reference-token", false, UserinfoAuthHandler.SchemeName)]
    public void Scheme_is_chosen_by_the_token_shape(string token, bool canDecrypt, string expected)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers.Authorization = "Bearer " + token;
        Assert.Equal(expected, UserinfoAuthHandler.SelectScheme(ctx, canDecrypt, userinfoAllowed: true));
        Assert.Equal(JwtBearerDefaults.AuthenticationScheme, UserinfoAuthHandler.SelectScheme(ctx, canDecrypt, userinfoAllowed: false));
    }

    sealed record Me(string Id, string? Name, string? Email);

    public sealed class StubUserinfo : HttpMessageHandler
    {
        public int Calls;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            if (request.RequestUri?.AbsolutePath != "/connect/userinfo" || request.Headers.Authorization?.Parameter != GoodToken)
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized));
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new { sub = "carol", name = "Carol", email = "carol@example.com", email_verified = true }),
            });
        }
    }

    public sealed class Factory : WebApplicationFactory<Program>
    {
        public StubUserinfo Userinfo { get; } = new();
        readonly string dataDir = Path.Combine(Path.GetTempPath(), "floorplan-tests", Guid.NewGuid().ToString("N"));

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("DataDir", dataDir);
            builder.UseSetting("Auth:Enabled", "true");
            builder.UseSetting("Oidc:Authority", "https://idp.test/");
            builder.UseSetting("Oidc:ClientId", "floorplan");
            builder.ConfigureTestServices(services =>
            {
                services.AddHttpClient("oidc").ConfigurePrimaryHttpMessageHandler(() => Userinfo);
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, o =>
                {
                    var c = new OpenIdConnectConfiguration { Issuer = "https://idp.test/", UserInfoEndpoint = "https://idp.test/connect/userinfo" };
                    o.Configuration = c;
                    o.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(c);
                });
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(dataDir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
}
