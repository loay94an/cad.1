using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Floorplan.Api.Storage;

namespace Floorplan.Api.Tests;

public sealed class FileTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private const long MiB = 1024 * 1024;

    private static MultipartFormDataContent Form(byte[] bytes, string fileName, string mime, string? id = null)
    {
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(mime);
        var form = new MultipartFormDataContent { { file, "file", fileName } };
        if (id is not null) form.Add(new StringContent(id), "id");
        return form;
    }

    [Fact]
    public async Task Upload_is_stored_at_home_room_fileid_ext_and_can_be_read_back()
    {
        var alice = api.As("alice");
        var homeId = await TestData.CreateHomeAsync(alice);
        var fileId = TestData.NewId();
        byte[] bytes = [0x25, 0x50, 0x44, 0x46, 1, 2, 3];

        var res = await alice.PostAsync($"/api/homes/{homeId}/rooms/kitchen/files", Form(bytes, "Plan.PDF", "application/pdf", fileId));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var dto = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(fileId, dto.GetProperty("id").GetString());
        Assert.Equal("kitchen", dto.GetProperty("roomId").GetString());
        Assert.Equal(bytes.Length, dto.GetProperty("size").GetInt64());

        var onDisk = Path.Combine(api.DataDir, homeId, "kitchen", $"{fileId}.pdf");
        Assert.True(File.Exists(onDisk), $"expected {onDisk}");
        Assert.Equal(bytes, await File.ReadAllBytesAsync(onDisk));

        var get = await alice.GetAsync($"/api/files/{fileId}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Equal("application/pdf", get.Content.Headers.ContentType?.MediaType);
        Assert.Equal(bytes, await get.Content.ReadAsByteArrayAsync());

        var list = await alice.GetFromJsonAsync<JsonElement>($"/api/homes/{homeId}/files");
        Assert.Single(list.EnumerateArray());
    }

    [Fact]
    public async Task Viewer_can_download_but_not_delete_and_stranger_gets_404()
    {
        var alice = api.As("alice");
        var homeId = await TestData.CreateHomeAsync(alice);
        await TestData.ShareAsync(alice, homeId, "bob", "viewer");
        var res = await alice.PostAsync($"/api/homes/{homeId}/rooms/r1/files", Form([1, 2, 3], "n.txt", "text/plain"));
        var fileId = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var bob = api.As("bob");
        Assert.Equal(HttpStatusCode.OK, (await bob.GetAsync($"/api/files/{fileId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.DeleteAsync($"/api/files/{fileId}")).StatusCode);

        var mallory = api.As("mallory");
        Assert.Equal(HttpStatusCode.NotFound, (await mallory.GetAsync($"/api/files/{fileId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mallory.DeleteAsync($"/api/files/{fileId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await mallory.PostAsync($"/api/homes/{homeId}/rooms/r1/files", Form([1], "x.txt", "text/plain"))).StatusCode);
    }

    [Fact]
    public async Task Delete_file_and_delete_home_remove_them_from_disk()
    {
        var alice = api.As("alice");
        var homeId = await TestData.CreateHomeAsync(alice);
        var a = TestData.NewId();
        var b = TestData.NewId();
        (await alice.PostAsync($"/api/homes/{homeId}/rooms/r1/files", Form([1], "a.png", "image/png", a))).EnsureSuccessStatusCode();
        (await alice.PostAsync($"/api/homes/{homeId}/rooms/r2/files", Form([2], "b.png", "image/png", b))).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/api/files/{a}")).StatusCode);
        Assert.False(File.Exists(Path.Combine(api.DataDir, homeId, "r1", $"{a}.png")));
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/api/files/{a}")).StatusCode);

        Assert.True(Directory.Exists(Path.Combine(api.DataDir, homeId)));
        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/api/homes/{homeId}")).StatusCode);
        Assert.False(Directory.Exists(Path.Combine(api.DataDir, homeId)));
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/api/files/{b}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/api/homes/{homeId}")).StatusCode);
    }

    [Theory]
    [InlineData("..")]
    [InlineData("a.b")]
    [InlineData("..%2F..%2Fetc")]
    [InlineData("%2E%2E")]
    public async Task Path_traversal_in_room_id_is_rejected(string roomId)
    {
        var alice = api.As("alice");
        var homeId = await TestData.CreateHomeAsync(alice);
        var res = await alice.PostAsync($"/api/homes/{homeId}/rooms/{roomId}/files", Form([1], "x.txt", "text/plain"));
        Assert.True(res.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.NotFound, $"got {res.StatusCode}");
        Assert.Empty(Directory.EnumerateFiles(api.DataDir, "*.txt", SearchOption.AllDirectories));
    }

    [Theory]
    [InlineData("../../escape")]
    [InlineData("a/b")]
    [InlineData("x.y")]
    public async Task Path_traversal_in_file_id_or_name_is_rejected(string fileId)
    {
        var alice = api.As("alice");
        var homeId = await TestData.CreateHomeAsync(alice);
        var res = await alice.PostAsync($"/api/homes/{homeId}/rooms/r1/files", Form([1], "x.txt", "text/plain", fileId));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        // A hostile file name only changes the display name, never the path.
        var ok = await alice.PostAsync($"/api/homes/{homeId}/rooms/r1/files", Form([1], "../../../evil.sh", "text/plain"));
        var dto = await ok.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("evil.sh", dto.GetProperty("name").GetString());
        Assert.True(File.Exists(Path.Combine(api.DataDir, homeId, "r1", $"{dto.GetProperty("id").GetString()}.sh")));
    }

    [Fact]
    public void FileStore_never_resolves_outside_the_data_directory()
    {
        var store = new FileStore(new AppOptions { DataDir = api.DataDir });
        Assert.Throws<InvalidOperationException>(() => store.FullPath("../outside.txt"));
        Assert.Throws<InvalidOperationException>(() => store.FullPath(Path.GetFullPath(Path.Combine(api.DataDir, "..", "x"))));
        Assert.Throws<ArgumentException>(() => FileStore.RelativePath("..", "r", "f", "txt"));
        Assert.Throws<ArgumentException>(() => FileStore.RelativePath("h", "r", "f", "t/x"));
        Assert.Equal("h1/r1/f1.jpg", FileStore.RelativePath("h1", "r1", "f1", "jpg"));
    }

    [Fact]
    public async Task File_over_20_MiB_gets_413()
    {
        var bytes = new byte[21 * MiB];
        new Random(1).NextBytes(bytes);
        var alice = api.As("alice");
        var homeId = await TestData.CreateHomeAsync(alice);
        var res = await alice.PostAsync($"/api/homes/{homeId}/rooms/r1/files", Form(bytes, "big.zip", "application/zip"));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
        Assert.False(Directory.Exists(Path.Combine(api.DataDir, homeId, "r1")));
    }

    [Fact]
    public async Task Html_uploads_are_served_as_sandboxed_downloads()
    {
        var alice = api.As("alice");
        var homeId = await TestData.CreateHomeAsync(alice);
        var res = await alice.PostAsync($"/api/homes/{homeId}/rooms/r1/files", Form("<script>alert(1)</script>"u8.ToArray(), "x.html", "text/html"));
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var get = await alice.GetAsync($"/api/files/{id}");
        Assert.Equal("application/octet-stream", get.Content.Headers.ContentType?.MediaType);
        Assert.Equal("attachment", get.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Contains("sandbox", get.Headers.GetValues("Content-Security-Policy").Single());
    }
}
