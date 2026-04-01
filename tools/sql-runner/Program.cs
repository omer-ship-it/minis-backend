using System.Text.Json;
using Microsoft.Data.SqlClient;

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage:");
    Console.Error.WriteLine("  dotnet run --project tools/sql-runner -- <path-to-sql-file>");
    Environment.Exit(1);
}

var sqlFilePath = args[0];

if (!File.Exists(sqlFilePath))
{
    Console.Error.WriteLine($"SQL file not found: {sqlFilePath}");
    Environment.Exit(1);
}

var connectionString = Environment.GetEnvironmentVariable("MINIS_READONLY_SQL_CONNECTION");
if (string.IsNullOrWhiteSpace(connectionString))
{
    LoadDotEnvFromNearest(".env");
    connectionString = Environment.GetEnvironmentVariable("MINIS_READONLY_SQL_CONNECTION");
}

if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("Missing environment variable: MINIS_READONLY_SQL_CONNECTION");
    Environment.Exit(1);
}

var sql = await File.ReadAllTextAsync(sqlFilePath);
var trimmed = sql.TrimStart();

if (!IsReadOnlyQuery(trimmed))
{
    Console.Error.WriteLine("Only read-only SELECT/WITH queries are allowed.");
    Environment.Exit(1);
}

try
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();

    await using var command = new SqlCommand(sql, connection)
    {
        CommandTimeout = 60
    };

    await using var reader = await command.ExecuteReaderAsync();

    var rows = new List<Dictionary<string, object?>>();
    while (await reader.ReadAsync())
    {
        var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < reader.FieldCount; i++)
        {
            var value = await reader.IsDBNullAsync(i) ? null : reader.GetValue(i);
            row[reader.GetName(i)] = Normalize(value);
        }
        rows.Add(row);
    }

    var json = JsonSerializer.Serialize(rows, new JsonSerializerOptions
    {
        WriteIndented = true
    });

    Console.WriteLine(json);
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    Environment.Exit(1);
}

static bool IsReadOnlyQuery(string sql)
{
    var upper = sql.ToUpperInvariant();

    // Block common destructive keywords anywhere in the text.
    string[] forbidden =
    [
        "INSERT ",
        "UPDATE ",
        "DELETE ",
        "DROP ",
        "ALTER ",
        "TRUNCATE ",
        "MERGE ",
        "CREATE ",
        "EXEC ",
        "EXECUTE ",
        "GRANT ",
        "REVOKE ",
        "DENY "
    ];

    if (forbidden.Any(upper.Contains))
        return false;

    return upper.StartsWith("SELECT ") || upper.StartsWith("WITH ");
}

static object? Normalize(object? value)
{
    return value switch
    {
        DateTime dt => dt.ToString("O"),
        DateTimeOffset dto => dto.ToString("O"),
        byte[] bytes => Convert.ToBase64String(bytes),
        _ => value
    };
}

static void LoadDotEnvFromNearest(string fileName)
{
    var dir = new DirectoryInfo(Environment.CurrentDirectory);
    while (dir is not null)
    {
        var candidate = Path.Combine(dir.FullName, fileName);
        if (File.Exists(candidate))
        {
            LoadDotEnvFile(candidate);
            return;
        }

        dir = dir.Parent;
    }
}

static void LoadDotEnvFile(string path)
{
    foreach (var rawLine in File.ReadLines(path))
    {
        var line = rawLine.Trim();
        if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#"))
            continue;

        if (line.StartsWith("export ", StringComparison.OrdinalIgnoreCase))
            line = line[7..].Trim();

        var idx = line.IndexOf('=');
        if (idx <= 0)
            continue;

        var key = line[..idx].Trim();
        var value = line[(idx + 1)..].Trim();
        if (string.IsNullOrWhiteSpace(key))
            continue;

        if ((value.StartsWith('"') && value.EndsWith('"')) ||
            (value.StartsWith('\'') && value.EndsWith('\'')))
        {
            value = value[1..^1];
        }

        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key)))
        {
            Environment.SetEnvironmentVariable(key, value);
        }
    }
}
