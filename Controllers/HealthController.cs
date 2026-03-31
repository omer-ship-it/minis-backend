using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace MinisBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    private readonly IWebHostEnvironment _environment;
    private readonly IConfiguration _configuration;

    public HealthController(IWebHostEnvironment environment, IConfiguration configuration)
    {
        _environment = environment;
        _configuration = configuration;
    }

    [HttpGet]
    public IActionResult Get()
    {
        return Ok(new
        {
            ok = true,
            service = "MinisBackend",
            environment = _environment.EnvironmentName,
            utc = DateTime.UtcNow
        });
    }

    [HttpGet("db")]
    public async Task<IActionResult> Db()
    {
        try
        {
            var connectionString = _configuration.GetConnectionString("DefaultConnection");

            if (string.IsNullOrWhiteSpace(connectionString))
            {
                return StatusCode(500, new
                {
                    ok = false,
                    db = false,
                    error = "Missing DefaultConnection connection string",
                    utc = DateTime.UtcNow
                });
            }

            await using var conn = new SqlConnection(connectionString);
            await conn.OpenAsync();

            await using var cmd = new SqlCommand("SELECT 1", conn);
            var result = await cmd.ExecuteScalarAsync();

            return Ok(new
            {
                ok = true,
                db = true,
                result,
                utc = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                ok = false,
                db = false,
                error = ex.Message,
                utc = DateTime.UtcNow
            });
        }
    }
}