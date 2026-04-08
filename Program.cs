using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();

var app = builder.Build();

var minisWebPath = Path.Combine(builder.Environment.ContentRootPath, "minis-web");
var minisWebProvider = new PhysicalFileProvider(minisWebPath);
var memoryCheckoutStore = new ConcurrentDictionary<string, MemoryCheckoutOrder>(StringComparer.Ordinal);
var memoryOrderSequence = 1000;

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
    environment = builder.Environment.EnvironmentName
}));

app.MapGet("/version", () => Results.Ok(new
{
    ok = true,
    service = "minis-backend",
    version = "v1",
    deployedAt = DateTime.UtcNow
}));

app.MapGet("/debug/config", (IConfiguration cfg) => Results.Ok(new
{
    hasGetConnectionStringDefaultConnection =
        !string.IsNullOrWhiteSpace(cfg.GetConnectionString("DefaultConnection")),

    hasSqlConnection =
        !string.IsNullOrWhiteSpace(cfg["SQL_CONNECTION"]),

    hasRawDefaultConnection =
        !string.IsNullOrWhiteSpace(cfg["DefaultConnection"]),

    hasConnectionStringsSectionDefaultConnection =
        !string.IsNullOrWhiteSpace(cfg["ConnectionStrings:DefaultConnection"]),

    hasEnvSqlConnection =
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SQL_CONNECTION")),

    hasEnvConnectionStringsDefaultConnection =
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")),

    aspnetcoreEnvironment =
        cfg["ASPNETCORE_ENVIRONMENT"],

    dotnetEnvironment =
        cfg["DOTNET_ENVIRONMENT"],

    websiteSiteName =
        cfg["WEBSITE_SITE_NAME"],

    websiteSlotName =
        cfg["WEBSITE_SLOT_NAME"]
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
        environment = builder.Environment.EnvironmentName,
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
        version = 1,
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

app.MapPost("/checkout/zcredit/card", async (
    CheckoutZcreditCardRequest req,
    IConfiguration config,
    HttpContext ctx,
    ILogger<Program> log,
    CancellationToken ct) =>
{
    static decimal R2(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    static string NormalizeIdempotency(string? raw) =>
        string.IsNullOrWhiteSpace(raw) ? Guid.NewGuid().ToString("N") : raw.Trim();

    static string NormalizeState(string? raw)
    {
        var value = (raw ?? "").Trim().ToLowerInvariant();
        return value switch
        {
            "approved" => "approved",
            "declined" => "declined",
            "pending" => "pending",
            "unknown" => "unknown",
            _ => "approved"
        };
    }

    static string? ResolveWriteConnectionString(IConfiguration cfg) =>
        cfg.GetConnectionString("DefaultConnection")
        ?? Environment.GetEnvironmentVariable("SQL_CONNECTION");

    static bool AllowMemoryFallback(IConfiguration cfg, IHostEnvironment env)
    {
        var configured = cfg["CheckoutDebug:AllowMemoryFallback"];
        if (!string.IsNullOrWhiteSpace(configured) && bool.TryParse(configured, out var parsed))
        {
            return parsed;
        }

        return env.IsDevelopment();
    }

    static string BuildMemoryKey(int miniAppId, string idempotencyKey) => $"{miniAppId}:{idempotencyKey}";

    static async Task<SqlConnection> OpenConnectionAsync(IConfiguration cfg, CancellationToken token)
    {
        var connectionString = ResolveWriteConnectionString(cfg);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Missing write connection string. Set ConnectionStrings:DefaultConnection or SQL_CONNECTION.");
        }

        var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(token);
        return connection;
    }

    static async Task<DbCheckoutOrder?> FindExistingAsync(SqlConnection conn, int miniAppId, string idempotencyKey, CancellationToken token)
    {
        const string sql = """
SELECT TOP (1)
    Id,
    MiniAppId,
    Total,
    Status,
    ISNULL(PaymentMethod, 'unpaid') AS PaymentMethod,
    CreatedAt,
    UpdatedAt,
    ISNULL(CAST(Metadata AS nvarchar(max)), '{}') AS MetadataJson,
    JSON_VALUE(Metadata, '$.checkout.state') AS CheckoutState,
    JSON_VALUE(Metadata, '$.checkout.referenceNumber') AS ReferenceNumber,
    JSON_VALUE(Metadata, '$.checkout.transactionId') AS TransactionId,
    JSON_VALUE(Metadata, '$.checkout.returnCode') AS ReturnCode,
    JSON_VALUE(Metadata, '$.checkout.returnMessage') AS ReturnMessage
FROM dbo.Orders
WHERE MiniAppId = @MiniAppId
  AND IdempotencyKeyRaw = @IdempotencyKey
ORDER BY Id DESC;
""";

        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@MiniAppId", miniAppId);
        cmd.Parameters.AddWithValue("@IdempotencyKey", idempotencyKey);

        await using var reader = await cmd.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token))
        {
            return null;
        }

        return new DbCheckoutOrder(
            OrderId: reader.GetInt32(reader.GetOrdinal("Id")),
            MiniAppId: reader.GetInt32(reader.GetOrdinal("MiniAppId")),
            Amount: reader.GetDecimal(reader.GetOrdinal("Total")),
            Status: reader.GetInt32(reader.GetOrdinal("Status")),
            PaymentMethod: reader.GetString(reader.GetOrdinal("PaymentMethod")),
            CreatedAtUtc: reader.GetDateTime(reader.GetOrdinal("CreatedAt")),
            UpdatedAtUtc: reader.GetDateTime(reader.GetOrdinal("UpdatedAt")),
            MetadataJson: reader.GetString(reader.GetOrdinal("MetadataJson")),
            Checkout: new DbCheckoutState(
                State: reader.IsDBNull(reader.GetOrdinal("CheckoutState")) ? "unknown" : reader.GetString(reader.GetOrdinal("CheckoutState")),
                ReferenceNumber: reader.IsDBNull(reader.GetOrdinal("ReferenceNumber")) ? null : reader.GetString(reader.GetOrdinal("ReferenceNumber")),
                TransactionId: reader.IsDBNull(reader.GetOrdinal("TransactionId")) ? null : reader.GetString(reader.GetOrdinal("TransactionId")),
                ReturnCode: reader.IsDBNull(reader.GetOrdinal("ReturnCode")) ? null : reader.GetString(reader.GetOrdinal("ReturnCode")),
                ReturnMessage: reader.IsDBNull(reader.GetOrdinal("ReturnMessage")) ? null : reader.GetString(reader.GetOrdinal("ReturnMessage"))));
    }

    static object BuildDbCheckoutResponse(DbCheckoutOrder order, bool replay, string traceId, string storageMode, string? storageWarning = null) => new
    {
        ok = order.Checkout.State == "paid",
        replay,
        orderId = order.OrderId,
        payment = order.Checkout.State,
        status = order.Status,
        paymentMethod = order.PaymentMethod,
        checkoutState = order.Checkout.State,
        referenceNumber = order.Checkout.ReferenceNumber,
        transactionId = order.Checkout.TransactionId,
        traceId,
        storageMode,
        storageWarning
    };

    static object BuildMemoryCheckoutResponse(MemoryCheckoutOrder order, bool replay, string traceId, string storageMode, string? storageWarning = null) => new
    {
        ok = order.Checkout.State == "paid",
        replay,
        orderId = order.OrderId,
        payment = order.Checkout.State,
        status = order.Status,
        paymentMethod = order.PaymentMethod,
        checkoutState = order.Checkout.State,
        referenceNumber = order.Checkout.ReferenceNumber,
        transactionId = order.Checkout.TransactionId,
        traceId,
        storageMode,
        storageWarning
    };

    static string BuildMetadataJson(
        CheckoutZcreditCardRequest request,
        CheckoutOrderPayload order,
        int miniAppId,
        string idempotencyKey,
        string orderSource,
        decimal amount,
        string currency,
        string transactionType,
        string checkoutState,
        string? referenceNumber,
        string? transactionId,
        string? returnCode,
        string? returnMessage)
    {
        var now = DateTime.UtcNow;
        var metadata = new
        {
            schema = "checkout.debug.v1",
            shopId = miniAppId,
            idempotency = idempotencyKey,
            createdAtUtc = now,
            orderSource,
            pinpadId = request.PinpadId,
            checkout = new
            {
                provider = "zcredit",
                method = "card",
                state = checkoutState,
                amount,
                currency,
                transactionType,
                referenceNumber,
                transactionId,
                returnCode,
                returnMessage,
                updatedAtUtc = now
            },
            order = order,
            basketCount = order.Basket?.Count ?? 0
        };

        return JsonSerializer.Serialize(metadata);
    }

    static async Task<int> InsertPendingOrderAsync(
        SqlConnection conn,
        CheckoutZcreditCardRequest request,
        CheckoutOrderPayload order,
        int miniAppId,
        string idempotencyKey,
        decimal amount,
        string currency,
        string transactionType,
        CancellationToken token)
    {
        var orderSource = string.IsNullOrWhiteSpace(order.Source) ? "mini-zcredit-card-debug" : order.Source.Trim();
        var metadataJson = BuildMetadataJson(
            request,
            order,
            miniAppId,
            idempotencyKey,
            orderSource,
            amount,
            currency,
            transactionType,
            checkoutState: "pending",
            referenceNumber: null,
            transactionId: null,
            returnCode: null,
            returnMessage: null);

        const string sql = """
INSERT INTO dbo.Orders
(
    MiniAppId,
    CustomerId,
    Total,
    Status,
    Metadata,
    CreatedAt,
    UpdatedAt,
    Source,
    PaymentMethod,
    TicketNumber,
    IdempotencyKeyRaw
)
VALUES
(
    @MiniAppId,
    @CustomerId,
    @Total,
    0,
    @Metadata,
    SYSUTCDATETIME(),
    SYSUTCDATETIME(),
    @Source,
    'unpaid',
    NULL,
    @IdempotencyKey
);
SELECT CAST(SCOPE_IDENTITY() AS int);
""";

        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@MiniAppId", miniAppId);
        cmd.Parameters.AddWithValue("@CustomerId", (object?)order.CustomerId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Total", amount);
        cmd.Parameters.AddWithValue("@Metadata", metadataJson);
        cmd.Parameters.AddWithValue("@Source", orderSource);
        cmd.Parameters.AddWithValue("@IdempotencyKey", idempotencyKey);

        var result = await cmd.ExecuteScalarAsync(token);
        return Convert.ToInt32(result);
    }

    static async Task UpdateOrderAsync(
        SqlConnection conn,
        int orderId,
        CheckoutZcreditCardRequest request,
        CheckoutOrderPayload order,
        int miniAppId,
        string idempotencyKey,
        decimal amount,
        string currency,
        string transactionType,
        string checkoutState,
        string? referenceNumber,
        string? transactionId,
        string? returnCode,
        string? returnMessage,
        CancellationToken token)
    {
        var orderSource = string.IsNullOrWhiteSpace(order.Source) ? "mini-zcredit-card-debug" : order.Source.Trim();
        var metadataJson = BuildMetadataJson(
            request,
            order,
            miniAppId,
            idempotencyKey,
            orderSource,
            amount,
            currency,
            transactionType,
            checkoutState,
            referenceNumber,
            transactionId,
            returnCode,
            returnMessage);

        const string sql = """
UPDATE dbo.Orders
SET
    Total = @Total,
    Status = @Status,
    PaymentMethod = @PaymentMethod,
    Metadata = @Metadata,
    UpdatedAt = SYSUTCDATETIME()
WHERE Id = @Id;
""";

        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@Id", orderId);
        cmd.Parameters.AddWithValue("@Total", amount);
        cmd.Parameters.AddWithValue("@Status", checkoutState == "paid" ? 1 : 0);
        cmd.Parameters.AddWithValue("@PaymentMethod", checkoutState == "paid" ? "card" : "unpaid");
        cmd.Parameters.AddWithValue("@Metadata", metadataJson);
        await cmd.ExecuteNonQueryAsync(token);
    }

    if (req is null || req.Order is null)
    {
        return Results.BadRequest(new { ok = false, error = "order required", traceId = ctx.TraceIdentifier });
    }

    var order = req.Order;
    var miniAppId = req.MiniAppId.GetValueOrDefault() > 0 ? req.MiniAppId!.Value : order.MiniAppId;
    if (miniAppId <= 0)
    {
        return Results.BadRequest(new { ok = false, error = "miniAppId required", traceId = ctx.TraceIdentifier });
    }

    if (req.Amount <= 0)
    {
        return Results.BadRequest(new { ok = false, error = "amount must be > 0", traceId = ctx.TraceIdentifier });
    }

    string? Corr(string key) =>
        ctx.Request.Headers.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.ToString()
            : null;

    var idempotencyKey = NormalizeIdempotency(
        Corr("Idempotency-Key")
        ?? Corr("X-Request-Id")
        ?? req.IdempotencyKey
        ?? order.IdempotencyKey);

    var traceId = ctx.TraceIdentifier;
    var amount = R2(req.Amount);
    var currency = string.IsNullOrWhiteSpace(req.Currency) ? "ILS" : req.Currency.Trim().ToUpperInvariant();
    var transactionType = string.IsNullOrWhiteSpace(req.TransactionType) ? "01" : req.TransactionType.Trim();
    var allowMemoryFallback = AllowMemoryFallback(config, app.Environment);

    SqlConnection? conn = null;
    string? storageWarning = null;
    try
    {
        conn = await OpenConnectionAsync(config, ct);
    }
    catch (Exception ex) when (allowMemoryFallback)
    {
        storageWarning = $"SQL unavailable, using memory fallback: {ex.Message}";
        log.LogWarning(ex,
            "Checkout SQL unavailable, falling back to memory miniAppId={MiniAppId} idem={Idem} trace={Trace}",
            miniAppId, idempotencyKey, traceId);
    }

    async Task<IResult> RunMemoryCheckoutAsync(
        ConcurrentDictionary<string, MemoryCheckoutOrder> store,
        int miniAppId,
        string idempotencyKey,
        decimal amount,
        string currency,
        CheckoutZcreditCardRequest req,
        string traceId,
        string? storageWarning,
        CancellationToken token)
    {
        var memoryKey = BuildMemoryKey(miniAppId, idempotencyKey);
        if (store.TryGetValue(memoryKey, out var existingMemory))
        {
            return existingMemory.Checkout.State switch
            {
                "paid" => Results.Ok(BuildMemoryCheckoutResponse(existingMemory, replay: true, traceId, "memory", storageWarning)),
                "declined" => Results.Json(BuildMemoryCheckoutResponse(existingMemory, replay: true, traceId, "memory", storageWarning), statusCode: 402),
                _ => Results.Json(BuildMemoryCheckoutResponse(existingMemory, replay: true, traceId, "memory", storageWarning), statusCode: 202)
            };
        }

        var createdAtUtc = DateTime.UtcNow;
        var memoryOrderId = Interlocked.Increment(ref memoryOrderSequence);
        var pendingMemory = new MemoryCheckoutOrder(
            OrderId: memoryOrderId,
            MiniAppId: miniAppId,
            IdempotencyKey: idempotencyKey,
            Amount: amount,
            Currency: currency,
            Status: 0,
            PaymentMethod: "unpaid",
            CreatedAtUtc: createdAtUtc,
            UpdatedAtUtc: createdAtUtc,
            Checkout: new MemoryCheckoutState("pending", null, null, null, null));

        if (!store.TryAdd(memoryKey, pendingMemory))
        {
            var raced = store[memoryKey];
            return raced.Checkout.State switch
            {
                "paid" => Results.Ok(BuildMemoryCheckoutResponse(raced, replay: true, traceId, "memory", storageWarning)),
                "declined" => Results.Json(BuildMemoryCheckoutResponse(raced, replay: true, traceId, "memory", storageWarning), statusCode: 402),
                _ => Results.Json(BuildMemoryCheckoutResponse(raced, replay: true, traceId, "memory", storageWarning), statusCode: 202)
            };
        }

        await Task.Delay(TimeSpan.FromMilliseconds(150), token);

        var simulatedOutcome = NormalizeState(req.DebugOutcome);
        var referenceNumber = simulatedOutcome == "approved" ? $"REF-{memoryOrderId}" : null;
        var transactionId = simulatedOutcome == "approved" ? $"TX-{memoryOrderId}" : null;
        var returnCode = simulatedOutcome switch
        {
            "approved" => "0",
            "declined" => "1001",
            "pending" => "-80",
            "unknown" => "CommitHttpError",
            _ => "0"
        };
        var returnMessage = simulatedOutcome switch
        {
            "approved" => "Approved",
            "declined" => "Declined",
            "pending" => "Pending confirmation",
            "unknown" => "Gateway response unknown",
            _ => "Approved"
        };
        var finalState = simulatedOutcome switch
        {
            "approved" => "paid",
            "declined" => "declined",
            "pending" => "pending",
            "unknown" => "unknown",
            _ => "paid"
        };

        var finalMemory = pendingMemory with
        {
            Status = finalState == "paid" ? 1 : 0,
            PaymentMethod = finalState == "paid" ? "card" : "unpaid",
            UpdatedAtUtc = DateTime.UtcNow,
            Checkout = new MemoryCheckoutState(finalState, referenceNumber, transactionId, returnCode, returnMessage)
        };
        store[memoryKey] = finalMemory;

        return finalState switch
        {
            "paid" => Results.Ok(BuildMemoryCheckoutResponse(finalMemory, replay: false, traceId, "memory", storageWarning)),
            "declined" => Results.Json(BuildMemoryCheckoutResponse(finalMemory, replay: false, traceId, "memory", storageWarning), statusCode: 402),
            _ => Results.Json(BuildMemoryCheckoutResponse(finalMemory, replay: false, traceId, "memory", storageWarning), statusCode: 202)
        };
    }

    if (conn is null)
    {
        if (!allowMemoryFallback)
        {
            throw new InvalidOperationException("SQL storage is required for this environment and no connection could be opened.");
        }

        return await RunMemoryCheckoutAsync(memoryCheckoutStore, miniAppId, idempotencyKey, amount, currency, req, traceId, storageWarning, ct);
    }

    await using (conn)
    {
        try
        {

        var existing = await FindExistingAsync(conn, miniAppId, idempotencyKey, ct);
        if (existing is not null)
        {
            log.LogWarning(
                "Replay checkout request miniAppId={MiniAppId} idem={Idem} orderId={OrderId} state={State} trace={Trace}",
                miniAppId, idempotencyKey, existing.OrderId, existing.Checkout.State, traceId);

            return existing.Checkout.State switch
            {
                "paid" => Results.Ok(BuildDbCheckoutResponse(existing, replay: true, traceId, "sql")),
                "declined" => Results.Json(BuildDbCheckoutResponse(existing, replay: true, traceId, "sql"), statusCode: 402),
                _ => Results.Json(BuildDbCheckoutResponse(existing, replay: true, traceId, "sql"), statusCode: 202)
            };
        }

        int orderId;
        try
        {
            orderId = await InsertPendingOrderAsync(conn, req, order, miniAppId, idempotencyKey, amount, currency, transactionType, ct);
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            var raced = await FindExistingAsync(conn, miniAppId, idempotencyKey, ct);
            if (raced is not null)
            {
                return raced.Checkout.State == "paid"
                    ? Results.Ok(BuildDbCheckoutResponse(raced, replay: true, traceId, "sql"))
                    : Results.Json(BuildDbCheckoutResponse(raced, replay: true, traceId, "sql"), statusCode: 202);
            }

            throw;
        }

        log.LogInformation(
            "Checkout pending row inserted miniAppId={MiniAppId} idem={Idem} orderId={OrderId} amount={Amount} txType={TxType} trace={Trace}",
            miniAppId, idempotencyKey, orderId, amount, transactionType, traceId);

        await Task.Delay(TimeSpan.FromMilliseconds(150), ct);

        var simulatedOutcome = NormalizeState(req.DebugOutcome);
        var referenceNumber = simulatedOutcome == "approved" ? $"REF-{orderId}" : null;
        var transactionId = simulatedOutcome == "approved" ? $"TX-{orderId}" : null;
        var returnCode = simulatedOutcome switch
        {
            "approved" => "0",
            "declined" => "1001",
            "pending" => "-80",
            "unknown" => "CommitHttpError",
            _ => "0"
        };
        var returnMessage = simulatedOutcome switch
        {
            "approved" => "Approved",
            "declined" => "Declined",
            "pending" => "Pending confirmation",
            "unknown" => "Gateway response unknown",
            _ => "Approved"
        };

        var finalState = simulatedOutcome switch
        {
            "approved" => "paid",
            "declined" => "declined",
            "pending" => "pending",
            "unknown" => "unknown",
            _ => "paid"
        };

        await UpdateOrderAsync(
            conn,
            orderId,
            req,
            order,
            miniAppId,
            idempotencyKey,
            amount,
            currency,
            transactionType,
            finalState,
            referenceNumber,
            transactionId,
            returnCode,
            returnMessage,
            ct);

        var finalOrder = await FindExistingAsync(conn, miniAppId, idempotencyKey, ct)
            ?? throw new InvalidOperationException($"Order {orderId} was updated but could not be reloaded.");

        log.LogInformation(
            "Checkout finalized miniAppId={MiniAppId} idem={Idem} orderId={OrderId} state={State} rc={Code} trace={Trace}",
            miniAppId, idempotencyKey, orderId, finalState, returnCode, traceId);

        return finalState switch
        {
            "paid" => Results.Ok(BuildDbCheckoutResponse(finalOrder, replay: false, traceId, "sql")),
            "declined" => Results.Json(BuildDbCheckoutResponse(finalOrder, replay: false, traceId, "sql"), statusCode: 402),
            _ => Results.Json(BuildDbCheckoutResponse(finalOrder, replay: false, traceId, "sql"), statusCode: 202)
        };
        }
        catch (SqlException ex) when (allowMemoryFallback && ex.Number == 208)
        {
            storageWarning = $"SQL schema unavailable, using memory fallback: {ex.Message}";
            log.LogWarning(ex,
                "Checkout SQL schema missing, falling back to memory miniAppId={MiniAppId} idem={Idem} trace={Trace}",
                miniAppId, idempotencyKey, traceId);

            return await RunMemoryCheckoutAsync(memoryCheckoutStore, miniAppId, idempotencyKey, amount, currency, req, traceId, storageWarning, ct);
        }
    }
});

app.MapGet("/checkout/debug/orders", async (IConfiguration config, CancellationToken ct) =>
{
    var connectionString =
        config.GetConnectionString("DefaultConnection")
        ?? Environment.GetEnvironmentVariable("SQL_CONNECTION");

    if (string.IsNullOrWhiteSpace(connectionString))
    {
        return Results.Problem("Missing write connection string. Set ConnectionStrings:DefaultConnection or SQL_CONNECTION.", statusCode: 503);
    }

    await using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync(ct);

    const string sql = """
SELECT TOP (50)
    Id,
    MiniAppId,
    Total,
    Status,
    ISNULL(PaymentMethod, 'unpaid') AS PaymentMethod,
    IdempotencyKeyRaw,
    CreatedAt,
    UpdatedAt,
    JSON_VALUE(Metadata, '$.checkout.state') AS CheckoutState,
    JSON_VALUE(Metadata, '$.checkout.referenceNumber') AS ReferenceNumber,
    JSON_VALUE(Metadata, '$.checkout.transactionId') AS TransactionId
FROM dbo.Orders
WHERE JSON_VALUE(Metadata, '$.schema') = 'checkout.debug.v1'
ORDER BY Id DESC;
""";

    await using var cmd = new SqlCommand(sql, conn);
    await using var reader = await cmd.ExecuteReaderAsync(ct);

    var orders = new List<object>();
    while (await reader.ReadAsync(ct))
    {
        orders.Add(new
        {
            orderId = reader.GetInt32(reader.GetOrdinal("Id")),
            miniAppId = reader.GetInt32(reader.GetOrdinal("MiniAppId")),
            idempotencyKey = reader.IsDBNull(reader.GetOrdinal("IdempotencyKeyRaw")) ? null : reader.GetString(reader.GetOrdinal("IdempotencyKeyRaw")),
            amount = reader.GetDecimal(reader.GetOrdinal("Total")),
            status = reader.GetInt32(reader.GetOrdinal("Status")),
            paymentMethod = reader.GetString(reader.GetOrdinal("PaymentMethod")),
            checkoutState = reader.IsDBNull(reader.GetOrdinal("CheckoutState")) ? null : reader.GetString(reader.GetOrdinal("CheckoutState")),
            referenceNumber = reader.IsDBNull(reader.GetOrdinal("ReferenceNumber")) ? null : reader.GetString(reader.GetOrdinal("ReferenceNumber")),
            transactionId = reader.IsDBNull(reader.GetOrdinal("TransactionId")) ? null : reader.GetString(reader.GetOrdinal("TransactionId")),
            createdAtUtc = reader.GetDateTime(reader.GetOrdinal("CreatedAt")),
            updatedAtUtc = reader.GetDateTime(reader.GetOrdinal("UpdatedAt"))
        });
    }

    return Results.Ok(new { ok = true, count = orders.Count, orders });
});

app.MapGet("/checkout/debug/orders/{miniAppId:int}/{idempotencyKey}", async (int miniAppId, string idempotencyKey, IConfiguration config, CancellationToken ct) =>
{
    var connectionString =
        config.GetConnectionString("DefaultConnection")
        ?? Environment.GetEnvironmentVariable("SQL_CONNECTION");

    if (string.IsNullOrWhiteSpace(connectionString))
    {
        return Results.Problem("Missing write connection string. Set ConnectionStrings:DefaultConnection or SQL_CONNECTION.", statusCode: 503);
    }

    await using var conn = new SqlConnection(connectionString);
    await conn.OpenAsync(ct);

    const string sql = """
SELECT TOP (1)
    Id,
    MiniAppId,
    Total,
    Status,
    ISNULL(PaymentMethod, 'unpaid') AS PaymentMethod,
    ISNULL(CAST(Metadata AS nvarchar(max)), '{}') AS MetadataJson,
    CreatedAt,
    UpdatedAt
FROM dbo.Orders
WHERE MiniAppId = @MiniAppId
  AND IdempotencyKeyRaw = @IdempotencyKey
ORDER BY Id DESC;
""";

    await using var cmd = new SqlCommand(sql, conn);
    cmd.Parameters.AddWithValue("@MiniAppId", miniAppId);
    cmd.Parameters.AddWithValue("@IdempotencyKey", idempotencyKey);

    await using var reader = await cmd.ExecuteReaderAsync(ct);
    if (!await reader.ReadAsync(ct))
    {
        return Results.NotFound(new { ok = false, error = "Order not found" });
    }

    var metadataJson = reader.GetString(reader.GetOrdinal("MetadataJson"));
    object metadata;
    try
    {
        metadata = JsonSerializer.Deserialize<object>(metadataJson) ?? new { };
    }
    catch
    {
        metadata = metadataJson;
    }

    return Results.Ok(new
    {
        ok = true,
        order = new
        {
            orderId = reader.GetInt32(reader.GetOrdinal("Id")),
            miniAppId = reader.GetInt32(reader.GetOrdinal("MiniAppId")),
            amount = reader.GetDecimal(reader.GetOrdinal("Total")),
            status = reader.GetInt32(reader.GetOrdinal("Status")),
            paymentMethod = reader.GetString(reader.GetOrdinal("PaymentMethod")),
            createdAtUtc = reader.GetDateTime(reader.GetOrdinal("CreatedAt")),
            updatedAtUtc = reader.GetDateTime(reader.GetOrdinal("UpdatedAt")),
            metadata
        }
    });
});

app.MapControllers();

app.Run();

internal record CheckoutZcreditCardRequest(
    int? MiniAppId,
    decimal Amount,
    string? Currency,
    string? IdempotencyKey,
    string? TransactionType,
    string? PinpadId,
    string? DebugOutcome,
    CheckoutOrderPayload? Order);

internal record CheckoutOrderPayload(
    int MiniAppId,
    int? CustomerId,
    string? UUID,
    string? Email,
    string? Name,
    string? Source,
    List<CheckoutBasketItem>? Basket,
    string? IdempotencyKey);

internal record CheckoutBasketItem(
    int? ProductId,
    string? Name,
    int Quantity,
    decimal Price,
    string? Modifiers);

internal record DbCheckoutOrder(
    int OrderId,
    int MiniAppId,
    decimal Amount,
    int Status,
    string PaymentMethod,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    string MetadataJson,
    DbCheckoutState Checkout);

internal record DbCheckoutState(
    string State,
    string? ReferenceNumber,
    string? TransactionId,
    string? ReturnCode,
    string? ReturnMessage);

internal record MemoryCheckoutOrder(
    int OrderId,
    int MiniAppId,
    string IdempotencyKey,
    decimal Amount,
    string Currency,
    int Status,
    string PaymentMethod,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    MemoryCheckoutState Checkout);

internal record MemoryCheckoutState(
    string State,
    string? ReferenceNumber,
    string? TransactionId,
    string? ReturnCode,
    string? ReturnMessage);
