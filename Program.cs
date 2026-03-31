var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/", () => "Minis backend is running");

app.MapGet("/api/generatejson", () =>
{
    return Results.Ok(new
    {
        success = true,
        message = "Local Minis backend works"
    });
});

app.Run();