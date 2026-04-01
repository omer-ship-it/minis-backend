using Microsoft.Extensions.FileProviders;

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
app.MapControllers();

app.Run();
