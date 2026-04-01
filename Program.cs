var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

var app = builder.Build();

app.MapGet("/", () => "Hello World");
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
app.MapControllers();

app.Run();
