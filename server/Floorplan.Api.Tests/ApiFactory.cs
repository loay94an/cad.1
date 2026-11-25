using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;

namespace Floorplan.Api.Tests;

/// <summary>The API in Development mode (dev auth via X-Dev-User) with its own temporary data directory.</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public string DataDir { get; } = Path.Combine(Path.GetTempPath(), "floorplan-tests", Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("DataDir", DataDir);
        builder.UseSetting("Auth:Enabled", "false");
    }

    public HttpClient As(string user)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(DataDir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

public static class TestData
{
    public static string NewId() => Guid.NewGuid().ToString("N");

    /// <summary>A minimal project document like the client sends.</summary>
    public static object Project(string id, string name = "Test home") => new
    {
        schemaVersion = 1,
        id,
        name,
        createdAt = "2026-11-15T10:00:00.000Z",
        updatedAt = "2026-11-15T10:00:00.000Z",
        settings = new { unit = "cm", defaultThickness_mm = 100 },
        floors = new[] { new { id = "floor1", name = "Ground", level = 0, rooms = Array.Empty<object>(), openings = Array.Empty<object>() } },
        layers = Array.Empty<object>(),
        attachments = Array.Empty<object>(),
        meta = new { },
    };

    public static async Task<string> CreateHomeAsync(HttpClient owner, string name = "Test home")
    {
        var id = NewId();
        var res = await owner.PostAsJsonAsync("/api/homes", new { id, name, document = Project(id, name) });
        res.EnsureSuccessStatusCode();
        return id;
    }

    public static async Task ShareAsync(HttpClient owner, string homeId, string user, string role)
    {
        var res = await owner.PostAsJsonAsync($"/api/homes/{homeId}/shares", new { email = $"{user}@dev.local", role });
        res.EnsureSuccessStatusCode();
    }
}
