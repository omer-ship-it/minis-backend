using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();

var app = builder.Build();

var minisWebPath = Path.Combine(builder.Environment.ContentRootPath, "minis-web");
var minisWebProvider = new PhysicalFileProvider(minisWebPath);

app.UseDefaultFiles(new DefaultFilesOptions
{
    FileProvider = minisWebProvider
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = minisWebProvider
});

app.MapGet("/wilde", () => Results.Redirect("/wilde.html"));
app.MapGet("/demo/wilde", () => Results.Redirect("/wilde.html"));

app.MapGet("/health", () => Results.Ok(new
{
    ok = true,
    service = "minis-backend",
    environment = "staging"
}));

app.MapGet("/version", () => Results.Ok(new
{
    ok = true,
    service = "minis-backend",
    version = "v1",
    deployedAt = DateTime.UtcNow
}));

app.MapGet("/health/full", async (IConfiguration config) =>
{
    var checks = new Dictionary<string, object?>();
    var ok = true;

    try
    {
        var connectionString =
            config.GetConnectionString("DefaultConnection")
            ?? Environment.GetEnvironmentVariable("SQL_CONNECTION");

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            ok = false;
            checks["database"] = "missing connection string";
        }
        else
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();
            await using var command = new SqlCommand("SELECT 1", connection);
            await command.ExecuteScalarAsync();
            checks["database"] = "ok";
        }
    }
    catch (Exception ex)
    {
        ok = false;
        checks["database"] = ex.Message;
    }

    checks["r2Configured"] =
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CF_R2_ACCOUNT_ID")) &&
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CF_R2_ACCESS_KEY_ID")) &&
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CF_R2_BUCKET"));

    return Results.Ok(new
    {
        ok,
        app = "minis-backend",
        environment = Environment.GetEnvironmentVariable("APP_ENVIRONMENT") ?? "unknown",
        checks
    });
});

app.MapGet("/api/menu/{miniAppId:int}", async (int miniAppId, IHttpClientFactory httpClientFactory, CancellationToken ct) =>
{
    if (miniAppId <= 0)
    {
        return Results.BadRequest(new { ok = false, error = "Invalid miniAppId" });
    }

    var sourceUrl = $"https://minis.studio/json/{miniAppId}.json";
    var client = httpClientFactory.CreateClient();
    client.Timeout = TimeSpan.FromSeconds(20);

    try
    {
        using var response = await client.GetAsync(sourceUrl, ct);
        if (!response.IsSuccessStatusCode)
        {
            return Results.Problem(
                detail: $"Upstream returned {(int)response.StatusCode}",
                title: "Failed to load menu JSON",
                statusCode: StatusCodes.Status502BadGateway
            );
        }

        var json = await response.Content.ReadAsStringAsync(ct);
        return Results.Content(json, "application/json");
    }
    catch (Exception ex)
    {
        return Results.Problem(
            detail: ex.Message,
            title: "Error loading menu JSON",
            statusCode: StatusCodes.Status502BadGateway
        );
    }
});

app.MapGet("/dev/publish-shop-json/{shopId:int}", async (int shopId) =>
{
    var uploader = new R2Uploader();

    var payload = new
    {
        shopId,
        updatedAtUtc = DateTime.UtcNow,
        products = new[]
        {
            new { id = 1, name = "Coffee", price = 12 },
            new { id = 2, name = "Croissant", price = 18 }
        }
    };

    var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
    {
        WriteIndented = true
    });

    await uploader.UploadJsonAsync($"json/{shopId}.json", json);

    return Results.Ok(new
    {
        ok = true,
        key = $"json/{shopId}.json"
    });
});
app.MapControllers();

app.Run();
