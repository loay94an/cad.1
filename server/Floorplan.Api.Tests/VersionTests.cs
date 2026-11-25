using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Floorplan.Api.Tests;

public sealed class VersionTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private static async Task<string> SaveVersionAsync(HttpClient client, string homeId, string name, bool auto = false, string docName = "Snapshot")
    {
        var res = await client.PostAsJsonAsync($"/api/homes/{homeId}/versions", new { name, auto, document = TestData.Project(homeId, docName) });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    [Fact]
    public async Task Owner_can_save_list_open_and_delete_a_version()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice);
        var v = await SaveVersionAsync(alice, id, "Current", docName: "Before");

        var list = await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{id}/versions");
        var row = list.EnumerateArray().Single();
        Assert.Equal("Current", row.GetProperty("name").GetString());
        Assert.Equal("alice", row.GetProperty("createdBy").GetString());
        Assert.False(row.GetProperty("auto").GetBoolean());
        Assert.False(row.TryGetProperty("document", out _));

        var one = await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{id}/versions/{v}");
        Assert.Equal("Before", one.GetProperty("document").GetProperty("name").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/api/homes/{id}/versions/{v}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/api/homes/{id}/versions/{v}")).StatusCode);
    }

    [Fact]
    public async Task Viewer_can_list_and_open_but_not_save_or_delete()
    {
        var alice = api.As("alice");
        var bob = api.As("bob");
        var id = await TestData.CreateHomeAsync(alice);
        await TestData.ShareAsync(alice, id, "bob", "viewer");
        var v = await SaveVersionAsync(alice, id, "Current");

        Assert.Single((await bob.GetFromJsonAsync<JsonElement>($"/api/homes/{id}/versions")).EnumerateArray());
        Assert.Equal(HttpStatusCode.OK, (await bob.GetAsync($"/api/homes/{id}/versions/{v}")).StatusCode);

        var post = await bob.PostAsJsonAsync($"/api/homes/{id}/versions", new { name = "Mine", document = TestData.Project(id) });
        Assert.Equal(HttpStatusCode.Forbidden, post.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.DeleteAsync($"/api/homes/{id}/versions/{v}")).StatusCode);
    }

    [Fact]
    public async Task Editor_can_save_and_delete()
    {
        var alice = api.As("alice");
        var bob = api.As("bob");
        var id = await TestData.CreateHomeAsync(alice);
        await TestData.ShareAsync(alice, id, "bob", "editor");
        var v = await SaveVersionAsync(bob, id, "After renovation");
        Assert.Equal(HttpStatusCode.NoContent, (await bob.DeleteAsync($"/api/homes/{id}/versions/{v}")).StatusCode);
    }

    [Fact]
    public async Task Strangers_get_404()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice);
        var v = await SaveVersionAsync(alice, id, "Current");
        var stranger = api.As("dev");
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/homes/{id}/versions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/homes/{id}/versions/{v}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/homes/{id}/versions/{v}")).StatusCode);
    }

    [Fact]
    public async Task Rejects_a_document_of_another_home_and_a_missing_name()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice);
        var other = await alice.PostAsJsonAsync($"/api/homes/{id}/versions", new { name = "x", document = TestData.Project(TestData.NewId()) });
        Assert.Equal(HttpStatusCode.BadRequest, other.StatusCode);
        var noName = await alice.PostAsJsonAsync($"/api/homes/{id}/versions", new { name = " ", document = TestData.Project(id) });
        Assert.Equal(HttpStatusCode.BadRequest, noName.StatusCode);
    }

    [Fact]
    public async Task Keeps_the_newest_ten_automatic_versions_and_every_named_one()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice);
        await SaveVersionAsync(alice, id, "Named");
        for (var i = 0; i < 12; i++) await SaveVersionAsync(alice, id, $"Before restore {i}", auto: true);

        var list = (await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{id}/versions")).EnumerateArray().ToList();
        Assert.Equal(10, list.Count(v => v.GetProperty("auto").GetBoolean()));
        Assert.Contains(list, v => v.GetProperty("name").GetString() == "Named");
        Assert.DoesNotContain(list, v => v.GetProperty("name").GetString() == "Before restore 0");
    }

    [Fact]
    public async Task Deleting_a_home_deletes_its_versions()
    {
        var alice = api.As("alice");
        var id = await TestData.CreateHomeAsync(alice);
        await SaveVersionAsync(alice, id, "Current");
        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/api/homes/{id}")).StatusCode);

        // Same id again: a fresh home with no versions.
        var res = await alice.PostAsJsonAsync("/api/homes", new { id, name = "Again", document = TestData.Project(id) });
        res.EnsureSuccessStatusCode();
        Assert.Empty((await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{id}/versions")).EnumerateArray());
    }
}
