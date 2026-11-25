using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Floorplan.Api.Tests;

public sealed class HomeTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Config_is_anonymous_and_says_auth_is_disabled_in_development()
    {
        var res = await api.CreateClient().GetFromJsonAsync<JsonElement>("/api/config");
        Assert.False(res.GetProperty("authEnabled").GetBoolean());
        Assert.True(res.TryGetProperty("authority", out _));
        Assert.True(res.TryGetProperty("clientId", out _));
        Assert.Equal("openid profile email", res.GetProperty("scopes").GetString());
        Assert.Equal(["dev", "alice", "bob"], res.GetProperty("devUsers").EnumerateArray().Select(u => u.GetString()));
    }

    [Fact]
    public async Task Dates_read_back_from_the_database_are_marked_UTC()
    {
        var bob = api.As("bob");
        var id = await TestData.CreateHomeAsync(bob);
        await bob.PostAsJsonAsync($"/api/homes/{id}/versions", new { name = "v1", document = TestData.Project(id) });

        var home = (await bob.GetFromJsonAsync<JsonElement[]>("/api/homes"))!.First(h => h.GetProperty("id").GetString() == id);
        Assert.EndsWith("Z", home.GetProperty("updatedAt").GetString());
        var version = (await bob.GetFromJsonAsync<JsonElement[]>($"/api/homes/{id}/versions"))![0];
        Assert.EndsWith("Z", version.GetProperty("createdAt").GetString());
    }

    [Fact]
    public async Task Post_takes_id_name_document_and_returns_the_summary()
    {
        var alice = api.As("alice");
        var id = TestData.NewId();
        var res = await alice.PostAsJsonAsync("/api/homes", new { id, name = "Given name", document = TestData.Project(id, "Doc name") });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var dto = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id, dto.GetProperty("id").GetString());
        Assert.Equal("Given name", dto.GetProperty("name").GetString());
        Assert.Equal("owner", dto.GetProperty("role").GetString());
        Assert.Equal(1, dto.GetProperty("version").GetInt32());
        Assert.Equal("alice", dto.GetProperty("ownerName").GetString());
        Assert.True(dto.TryGetProperty("updatedAt", out _));

        var again = await alice.PostAsJsonAsync("/api/homes", new { id, name = "x", document = TestData.Project(id) });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Me_uses_the_dev_user_header()
    {
        var me = await api.As("alice").GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Equal("alice", me.GetProperty("id").GetString());
        Assert.Equal("alice@dev.local", me.GetProperty("email").GetString());

        var dev = await api.CreateClient().GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Equal("dev", dev.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Owner_can_create_read_and_save_a_home()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice, "Rue de la Loi 16");

        var home = await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{id}");
        Assert.Equal("owner", home.GetProperty("role").GetString());
        Assert.Equal(1, home.GetProperty("version").GetInt32());
        Assert.Equal("Rue de la Loi 16", home.GetProperty("name").GetString());
        Assert.Equal(id, home.GetProperty("document").GetProperty("id").GetString());
        Assert.Equal("Ground", home.GetProperty("document").GetProperty("floors")[0].GetProperty("name").GetString());

        var put = await alice.PutAsJsonAsync($"/api/homes/{id}", new { name = "Renamed", version = 1, document = TestData.Project(id, "Doc") });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(2, (await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetInt32());

        var list = await alice.GetFromJsonAsync<JsonElement>("/api/homes");
        var row = list.EnumerateArray().Single(h => h.GetProperty("id").GetString() == id);
        Assert.Equal("Renamed", row.GetProperty("name").GetString());
        Assert.Equal("owner", row.GetProperty("role").GetString());
    }

    [Fact]
    public async Task Put_with_a_stale_version_returns_409_with_the_current_version()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice);
        (await alice.PutAsJsonAsync($"/api/homes/{id}", new { version = 1, document = TestData.Project(id, "v2") })).EnsureSuccessStatusCode();

        var stale = await alice.PutAsJsonAsync($"/api/homes/{id}", new { version = 1, document = TestData.Project(id, "lost") });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var body = await stale.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, body.GetProperty("version").GetInt32());

        var home = await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{id}");
        Assert.Equal("v2", home.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Put_with_version_0_creates_a_new_home()
    {
        var alice = api.As("alice");
        var id = TestData.NewId();
        var res = await alice.PutAsJsonAsync($"/api/homes/{id}", new { version = 0, document = TestData.Project(id) });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.Equal(1, (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetInt32());

        // Creating again with version 0 is now a conflict, not a second create.
        var again = await alice.PutAsJsonAsync($"/api/homes/{id}", new { version = 0, document = TestData.Project(id) });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Put_rejects_a_document_whose_id_does_not_match()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice);
        var res = await alice.PutAsJsonAsync($"/api/homes/{id}", new { version = 1, document = TestData.Project("other") });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Stranger_gets_404_for_everything()
    {
        var alice = api.As("alice");
        var mallory = api.As("mallory");
        var id = await TestData.CreateHomeAsync(alice);

        Assert.Equal(HttpStatusCode.NotFound, (await mallory.GetAsync($"/api/homes/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await mallory.PutAsJsonAsync($"/api/homes/{id}", new { version = 1, document = TestData.Project(id) })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await mallory.PutAsJsonAsync($"/api/homes/{id}", new { version = 0, document = TestData.Project(id) })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mallory.DeleteAsync($"/api/homes/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mallory.GetAsync($"/api/homes/{id}/shares")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mallory.GetAsync($"/api/homes/{id}/files")).StatusCode);

        var list = await mallory.GetFromJsonAsync<JsonElement>("/api/homes");
        Assert.DoesNotContain(list.EnumerateArray(), h => h.GetProperty("id").GetString() == id);
        // Still intact for the owner.
        Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync($"/api/homes/{id}")).StatusCode);
    }

    [Fact]
    public async Task Viewer_can_read_but_not_write()
    {
        var alice = api.As("alice");
        var bob = api.As("bob");
        var id = await TestData.CreateHomeAsync(alice);
        await TestData.ShareAsync(alice, id, "bob", "viewer");

        var home = await bob.GetFromJsonAsync<JsonElement>($"/api/homes/{id}");
        Assert.Equal("viewer", home.GetProperty("role").GetString());
        Assert.Equal("alice", home.GetProperty("ownerName").GetString());

        var list = await bob.GetFromJsonAsync<JsonElement>("/api/homes");
        Assert.Equal("viewer", list.EnumerateArray().Single(h => h.GetProperty("id").GetString() == id).GetProperty("role").GetString());

        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PutAsJsonAsync($"/api/homes/{id}", new { version = 1, document = TestData.Project(id, "bob was here") })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.DeleteAsync($"/api/homes/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.GetAsync($"/api/homes/{id}/shares")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PostAsJsonAsync($"/api/homes/{id}/shares", new { email = "carol@dev.local", role = "editor" })).StatusCode);

        var upload = new MultipartFormDataContent { { new ByteArrayContent([1, 2, 3]), "file", "a.txt" } };
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.PostAsync($"/api/homes/{id}/rooms/room1/files", upload)).StatusCode);

        var after = await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{id}");
        Assert.Equal(1, after.GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Editor_can_save_but_not_delete_or_share()
    {
        var alice = api.As("alice");
        var carol = api.As("carol");
        var id = await TestData.CreateHomeAsync(alice);
        await TestData.ShareAsync(alice, id, "carol", "editor");

        var put = await carol.PutAsJsonAsync($"/api/homes/{id}", new { version = 1, document = TestData.Project(id, "by carol") });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await carol.DeleteAsync($"/api/homes/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await carol.GetAsync($"/api/homes/{id}/shares")).StatusCode);
    }

    [Fact]
    public async Task Shares_can_be_listed_changed_and_removed_by_the_owner()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice);
        // dave has never signed in: the share is kept by email and applies once he does.
        await TestData.ShareAsync(alice, id, "dave", "viewer");
        await TestData.ShareAsync(alice, id, "dave", "editor");

        var shares = await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{id}/shares");
        var share = Assert.Single(shares.EnumerateArray());
        Assert.Equal("dave@dev.local", share.GetProperty("email").GetString());
        Assert.Equal("editor", share.GetProperty("role").GetString());

        var dave = api.As("dave");
        Assert.Equal("editor", (await dave.GetFromJsonAsync<JsonElement>($"/api/homes/{id}")).GetProperty("role").GetString());

        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PostAsJsonAsync($"/api/homes/{id}/shares", new { email = "x@dev.local", role = "owner" })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/api/homes/{id}/shares/{Uri.EscapeDataString("dave@dev.local")}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await dave.GetAsync($"/api/homes/{id}")).StatusCode);
    }

    [Fact]
    public async Task Unknown_api_paths_are_404_not_the_spa()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await api.CreateClient().GetAsync("/api/nope")).StatusCode);
    }

    [Fact]
    public void App_refuses_to_start_with_auth_disabled_outside_development()
    {
        var dir = Path.Combine(Path.GetTempPath(), "floorplan-tests", Guid.NewGuid().ToString("N"));
        using var prod = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("DataDir", dir);
            b.UseSetting("Auth:Enabled", "false");
        });
        var ex = Assert.ThrowsAny<Exception>(() => prod.CreateClient());
        Assert.Contains("only allowed in the Development environment", Flatten(ex));
    }

    [Fact]
    public async Task With_auth_enabled_requests_without_a_token_get_401_and_config_has_no_dev_users()
    {
        var dir = Path.Combine(Path.GetTempPath(), "floorplan-tests", Guid.NewGuid().ToString("N"));
        using var prod = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("DataDir", dir);
            b.UseSetting("Auth:Enabled", "true");
            b.UseSetting("Oidc:Authority", "https://auth.example.invalid/application/o/floorplan/");
            b.UseSetting("Oidc:ClientId", "floorplan");
        });
        var client = prod.CreateClient();
        var config = await client.GetFromJsonAsync<JsonElement>("/api/config");
        Assert.True(config.GetProperty("authEnabled").GetBoolean());
        Assert.Equal("floorplan", config.GetProperty("clientId").GetString());
        Assert.False(config.TryGetProperty("devUsers", out _));

        foreach (var path in new[] { "/api/me", "/api/homes", "/api/homes/abc", "/api/files/abc" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(path)).StatusCode);

        // The dev header means nothing when auth is on.
        client.DefaultRequestHeaders.Add("X-Dev-User", "alice");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Cors_preflight_from_the_vite_dev_server_is_allowed_in_development()
    {
        var req = new HttpRequestMessage(HttpMethod.Options, "/api/homes");
        req.Headers.Add("Origin", "http://localhost:5173");
        req.Headers.Add("Access-Control-Request-Method", "PUT");
        req.Headers.Add("Access-Control-Request-Headers", "authorization,content-type,x-dev-user");
        var res = await api.CreateClient().SendAsync(req);
        Assert.True(res.IsSuccessStatusCode, $"got {res.StatusCode}");
        Assert.Equal("http://localhost:5173", res.Headers.GetValues("Access-Control-Allow-Origin").Single());
        var allowed = string.Join(",", res.Headers.GetValues("Access-Control-Allow-Headers")).ToLowerInvariant();
        Assert.Contains("x-dev-user", allowed);
        Assert.Contains("authorization", allowed);
    }

    private static string Flatten(Exception ex) => ex.InnerException is null ? ex.Message : ex.Message + " | " + Flatten(ex.InnerException);
}
