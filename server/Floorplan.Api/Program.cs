using Floorplan.Api;
using Floorplan.Api.Auth;
using Floorplan.Api.Database;
using Floorplan.Api.Endpoints;
using Floorplan.Api.Storage;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

var authEnabled = config.GetValue("Auth:Enabled", true);
if (!authEnabled && !builder.Environment.IsDevelopment())
    throw new InvalidOperationException(
        $"Auth:Enabled=false is only allowed in the Development environment (this is '{builder.Environment.EnvironmentName}').");

var options = new AppOptions
{
    DataDir = Path.GetFullPath(config["DataDir"] is { Length: > 0 } d ? d : "./data", builder.Environment.ContentRootPath),
    MaxFileBytes = config.GetValue("Files:MaxFileBytes", 20L * 1024 * 1024),
    AuthEnabled = authEnabled,
    Authority = config["Oidc:Authority"] is { Length: > 0 } authority ? authority : null,
    ClientId = config["Oidc:ClientId"] is { Length: > 0 } clientId ? clientId : null,
    Scopes = config["Oidc:Scopes"] is { Length: > 0 } s ? s : "openid profile email",
};
Directory.CreateDirectory(options.DataDir);

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<FileStore>();
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={Path.Combine(options.DataDir, "floorplan.db")}"));
builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient("oidc");
builder.Services.AddScoped<CurrentUser>();
builder.Services.AddProblemDetails();
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = options.MaxUploadBytes);

if (authEnabled)
{
    if (string.IsNullOrWhiteSpace(options.Authority))
        throw new InvalidOperationException("Oidc:Authority is required when auth is enabled (env: Oidc__Authority).");
    var audience = config["Oidc:Audience"] is { Length: > 0 } a ? a : options.ClientId;

    var canDecrypt = config["Oidc:TokenDecryptionCert:Path"] is { Length: > 0 } || config["Oidc:TokenDecryptionKey"] is { Length: > 0 };
    var userinfoAllowed = config.GetValue("Oidc:UserinfoFallback", true);
    builder.Services.AddMemoryCache();
    builder.Services.AddAuthentication("Oidc")
        // A JWT the API can verify goes to JwtBearer; an encrypted or opaque token is checked at the provider's userinfo endpoint.
        .AddPolicyScheme("Oidc", null, o => o.ForwardDefaultSelector = ctx => UserinfoAuthHandler.SelectScheme(ctx, canDecrypt, userinfoAllowed))
        .AddScheme<AuthenticationSchemeOptions, UserinfoAuthHandler>(UserinfoAuthHandler.SchemeName, null)
        .AddJwtBearer(o =>
        {
            o.Authority = options.Authority;
            o.Audience = audience;
            o.MapInboundClaims = false;
            o.RequireHttpsMetadata = config.GetValue("Oidc:RequireHttpsMetadata", true);
            o.TokenValidationParameters.NameClaimType = UserClaims.Name;
            OidcTokens.Configure(o.TokenValidationParameters, config, audience, options.ClientId);
            o.Events = new JwtBearerEvents
            {
                // Say why a token was refused: otherwise a 401 leaves nothing in the logs.
                OnAuthenticationFailed = ctx =>
                {
                    ctx.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
                        .CreateLogger("Floorplan.Api.Auth")
                        .LogWarning("Access token refused: {Reason}", ctx.Exception.Message);
                    return Task.CompletedTask;
                },
            };
        });
}
else
{
    builder.Services.AddAuthentication(DevAuthHandler.SchemeName)
        .AddScheme<AuthenticationSchemeOptions, DevAuthHandler>(DevAuthHandler.SchemeName, null);
}
builder.Services.AddAuthorization();

var corsOrigins = config.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders(HeaderNames.ContentDisposition)));

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    // Behind a reverse proxy (Traefik, Caddy, nginx) in Docker: trust its X-Forwarded-* headers.
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<AppDb>().Database.MigrateAsync();

if (!authEnabled)
    app.Logger.LogWarning("Auth is DISABLED (development mode): requests are signed in as 'dev' or the {Header} header.",
        DevAuthHandler.HeaderName);

app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment()) app.UseExceptionHandler();

// The built PWA. index.html, the service worker and the manifest must always be revalidated.
var staticFiles = new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var file = ctx.File.Name;
        if (file is "index.html" or "sw.js" or "registerSW.js" or "manifest.webmanifest" || file.StartsWith("workbox-"))
            ctx.Context.Response.Headers[HeaderNames.CacheControl] = "no-cache";
    },
};
app.UseDefaultFiles();
app.UseStaticFiles(staticFiles);

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/config", () => options.AuthEnabled
    ? Results.Ok(new { authEnabled = true, authority = options.Authority, clientId = options.ClientId, scopes = options.Scopes })
    // With auth off, devUsers lists names the PWA can offer for the X-Dev-User header.
    : Results.Ok(new { authEnabled = false, authority = options.Authority, clientId = options.ClientId, scopes = options.Scopes,
        devUsers = DevAuthHandler.DevUsers })).AllowAnonymous();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

var api = app.MapGroup("/api").RequireAuthorization();
api.MapHomes();
api.MapShares();
api.MapFiles(options);
api.MapVersions();

// Unknown /api paths are 404s, not the SPA.
app.Map("/api/{**rest}", () => Results.NotFound());
app.MapFallbackToFile("index.html", staticFiles);

app.Run();

public partial class Program;
