using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Text.Json;
using System.Text.Json.Serialization;
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

app.MapGet("/debug/host", () => Results.Ok(new
{
    machineName = Environment.MachineName,
    websiteInstanceId = Environment.GetEnvironmentVariable("WEBSITE_INSTANCE_ID"),
    websiteSiteName = Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"),
    websiteHostName = Environment.GetEnvironmentVariable("WEBSITE_HOSTNAME"),
    computerName = Environment.GetEnvironmentVariable("COMPUTERNAME")
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
    IHttpClientFactory httpFactory,
    HttpContext ctx,
    ILogger<Program> log,
    CancellationToken ct) =>
{
    try
    {
    static decimal R2(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    static string NormalizeIdempotency(string? raw) =>
        string.IsNullOrWhiteSpace(raw) ? Guid.NewGuid().ToString("N") : raw.Trim();

    static string NormalizeSource(string? raw)
    {
        return "cashpoint";
    }

    static string ResolveSubmitMode(IConfiguration cfg, IHostEnvironment env)
    {
        var configured = (cfg["CheckoutDebug:SubmitMode"] ?? "").Trim().ToLowerInvariant();
        if (configured is "off" or "fake" or "real")
        {
            return configured;
        }

        return env.IsDevelopment() ? "fake" : "real";
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
    JSON_VALUE(Metadata, '$.checkout.submitState') AS SubmitState,
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
                SubmitState: reader.IsDBNull(reader.GetOrdinal("SubmitState")) ? "not_started" : reader.GetString(reader.GetOrdinal("SubmitState")),
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
        submitState = order.Checkout.SubmitState,
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
        submitState = order.Checkout.SubmitState,
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
        string submitState,
        string? referenceNumber,
        string? transactionId,
        string? returnCode,
        string? returnMessage,
        int? submittedOrderId = null,
        bool? submitReplay = null,
        int? submitHttpStatus = null,
        string? submitError = null,
        DateTime? submitAttemptedAtUtc = null)
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
                submitState,
                amount,
                currency,
                transactionType,
                referenceNumber,
                transactionId,
                returnCode,
                returnMessage,
                updatedAtUtc = now
            },
            submit = new
            {
                state = submitState,
                orderId = submittedOrderId,
                replay = submitReplay,
                httpStatus = submitHttpStatus,
                error = submitError,
                attemptedAtUtc = submitAttemptedAtUtc
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
        var orderSource = NormalizeSource(order.Source);
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
            submitState: "not_started",
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
    AutoPrintEligible,
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
    0,
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
        string submitState,
        string? referenceNumber,
        string? transactionId,
        string? returnCode,
        string? returnMessage,
        int? submittedOrderId,
        bool? submitReplay,
        int? submitHttpStatus,
        string? submitError,
        DateTime? submitAttemptedAtUtc,
        CancellationToken token)
    {
        var orderSource = NormalizeSource(order.Source);
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
            submitState,
            referenceNumber,
            transactionId,
            returnCode,
            returnMessage,
            submittedOrderId,
            submitReplay,
            submitHttpStatus,
            submitError,
            submitAttemptedAtUtc);

        const string sql = """
UPDATE dbo.Orders
SET
    Total = @Total,
    Status = @Status,
    PaymentMethod = @PaymentMethod,
    PaymentReference = @PaymentReference,
    PaymentApprovedAtUtc = @PaymentApprovedAtUtc,
    Metadata = @Metadata,
    UpdatedAt = SYSUTCDATETIME()
WHERE Id = @Id;
""";

        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@Id", orderId);
        cmd.Parameters.AddWithValue("@Total", amount);
        cmd.Parameters.AddWithValue("@Status", checkoutState == "paid" ? 1 : 0);
        cmd.Parameters.AddWithValue("@PaymentMethod", checkoutState == "paid" ? "card" : "unpaid");
        cmd.Parameters.AddWithValue("@PaymentReference", (object?)referenceNumber ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@PaymentApprovedAtUtc",
            checkoutState == "paid"
                ? DateTime.UtcNow
                : DBNull.Value);
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

    if (!req.Order.CustomerId.HasValue || req.Order.CustomerId.Value <= 0)
    {
        return Results.BadRequest(new { ok = false, error = "order.customerId is required", traceId = ctx.TraceIdentifier });
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
    var submitMode = ResolveSubmitMode(config, app.Environment);
    var normalizedOrder = req.Order with { Source = NormalizeSource(req.Order.Source) };
    var gateway = ZcreditGatewayFactory.Create(config, log);

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
            Checkout: new MemoryCheckoutState("pending", "not_started", null, null, null, null));

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

        var gatewayResult = await gateway.CommitAsync(new GatewayCommitRequest(
            MiniAppId: miniAppId,
            OrderId: memoryOrderId,
            Amount: amount,
            Currency: currency,
            IdempotencyKey: idempotencyKey,
            TransactionType: transactionType,
            PinpadId: req.PinpadId,
            DebugOutcome: req.DebugOutcome), token);

        var finalMemory = pendingMemory with
        {
            Status = gatewayResult.CheckoutState == "paid" ? 1 : 0,
            PaymentMethod = gatewayResult.CheckoutState == "paid" ? "card" : "unpaid",
            UpdatedAtUtc = DateTime.UtcNow,
            Checkout = new MemoryCheckoutState(
                gatewayResult.CheckoutState,
                gatewayResult.CheckoutState == "paid" && submitMode != "off" ? "done" : "not_started",
                gatewayResult.ReferenceNumber,
                gatewayResult.TransactionId,
                gatewayResult.ReturnCode,
                gatewayResult.ReturnMessage)
        };
        store[memoryKey] = finalMemory;

        return gatewayResult.CheckoutState switch
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
            if (existing.Checkout.State == "paid" && existing.Checkout.SubmitState != "done" && submitMode != "off")
            {
                var submitResult = await SubmitOrderHelper.SubmitAsync(
                    httpFactory,
                    config,
                    log,
                    app.Environment,
                    normalizedOrder,
                    miniAppId,
                    existing.OrderId,
                    amount,
                    currency,
                    idempotencyKey,
                    req.PinpadId,
                    transactionType,
                    new GatewayResult(
                        existing.Checkout.State,
                        existing.Checkout.ReferenceNumber,
                        existing.Checkout.TransactionId,
                        existing.Checkout.ReturnCode,
                        existing.Checkout.ReturnMessage),
                    ct);

                await UpdateOrderAsync(
                    conn,
                    existing.OrderId,
                    req,
                    normalizedOrder,
                    miniAppId,
                    idempotencyKey,
                    amount,
                    currency,
                    transactionType,
                    existing.Checkout.State,
                    submitResult.SubmitState,
                    existing.Checkout.ReferenceNumber,
                    existing.Checkout.TransactionId,
                    existing.Checkout.ReturnCode,
                    existing.Checkout.ReturnMessage,
                    submitResult.SubmittedOrderId,
                    submitResult.Replay,
                    submitResult.HttpStatus,
                    submitResult.Error,
                    submitResult.AttemptedAtUtc,
                    ct);

                existing = await FindExistingAsync(conn, miniAppId, idempotencyKey, ct) ?? existing;
            }

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
            orderId = await InsertPendingOrderAsync(conn, req, normalizedOrder, miniAppId, idempotencyKey, amount, currency, transactionType, ct);
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

        var gatewayResult = await gateway.CommitAsync(new GatewayCommitRequest(
            MiniAppId: miniAppId,
            OrderId: orderId,
            Amount: amount,
            Currency: currency,
            IdempotencyKey: idempotencyKey,
            TransactionType: transactionType,
            PinpadId: req.PinpadId,
            DebugOutcome: req.DebugOutcome), ct);

        await UpdateOrderAsync(
            conn,
            orderId,
            req,
            normalizedOrder,
            miniAppId,
            idempotencyKey,
            amount,
            currency,
            transactionType,
            gatewayResult.CheckoutState,
            "not_started",
            gatewayResult.ReferenceNumber,
            gatewayResult.TransactionId,
            gatewayResult.ReturnCode,
            gatewayResult.ReturnMessage,
            null,
            null,
            null,
            null,
            null,
            ct);

        if (gatewayResult.CheckoutState == "paid")
        {
            var submitResult = await SubmitOrderHelper.SubmitAsync(
                httpFactory,
                config,
                log,
                app.Environment,
                normalizedOrder,
                miniAppId,
                orderId,
                amount,
                currency,
                idempotencyKey,
                req.PinpadId,
                transactionType,
                gatewayResult,
                ct);

            await UpdateOrderAsync(
                conn,
                orderId,
                req,
                normalizedOrder,
                miniAppId,
                idempotencyKey,
                amount,
                currency,
                transactionType,
                gatewayResult.CheckoutState,
                submitResult.SubmitState,
                gatewayResult.ReferenceNumber,
                gatewayResult.TransactionId,
                gatewayResult.ReturnCode,
                gatewayResult.ReturnMessage,
                submitResult.SubmittedOrderId,
                submitResult.Replay,
                submitResult.HttpStatus,
                submitResult.Error,
                submitResult.AttemptedAtUtc,
                ct);
        }

        var finalOrder = await FindExistingAsync(conn, miniAppId, idempotencyKey, ct)
            ?? throw new InvalidOperationException($"Order {orderId} was updated but could not be reloaded.");

        log.LogInformation(
            "Checkout finalized miniAppId={MiniAppId} idem={Idem} orderId={OrderId} state={State} rc={Code} trace={Trace}",
            miniAppId, idempotencyKey, orderId, gatewayResult.CheckoutState, gatewayResult.ReturnCode, traceId);

        return gatewayResult.CheckoutState switch
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
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Checkout debug endpoint failed trace={Trace}", ctx.TraceIdentifier);
        return Results.Json(new
        {
            ok = false,
            error = ex.Message,
            type = ex.GetType().FullName,
            traceId = ctx.TraceIdentifier
        }, statusCode: 500);
    }
});

app.MapPost("/checkout/zcredit/card/reconcile", async (
    CheckoutReconcileRequest req,
    IConfiguration config,
    IHttpClientFactory httpFactory,
    HttpContext ctx,
    ILogger<Program> log,
    CancellationToken ct) =>
{
    try
    {
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

        if (req.MiniAppId <= 0 || string.IsNullOrWhiteSpace(req.IdempotencyKey))
        {
            return Results.BadRequest(new { ok = false, error = "miniAppId and idempotencyKey are required", traceId = ctx.TraceIdentifier });
        }

        var allowMemoryFallback = AllowMemoryFallback(config, app.Environment);
        var idempotencyKey = req.IdempotencyKey.Trim();

        SqlConnection? conn = null;
        string? storageWarning = null;
        try
        {
            var connectionString = ResolveWriteConnectionString(config);
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                throw new InvalidOperationException("Missing write connection string. Set ConnectionStrings:DefaultConnection or SQL_CONNECTION.");
            }

            conn = new SqlConnection(connectionString);
            await conn.OpenAsync(ct);
        }
        catch (Exception ex) when (allowMemoryFallback)
        {
            storageWarning = $"SQL unavailable, using memory fallback: {ex.Message}";
            log.LogWarning(ex,
                "Checkout reconcile SQL unavailable, falling back to memory miniAppId={MiniAppId} idem={Idem} trace={Trace}",
                req.MiniAppId, idempotencyKey, ctx.TraceIdentifier);
        }

        if (conn is null)
        {
            var memoryKey = BuildMemoryKey(req.MiniAppId, idempotencyKey);
            if (!memoryCheckoutStore.TryGetValue(memoryKey, out var memoryOrder))
            {
                return Results.NotFound(new { ok = false, error = "Order not found", traceId = ctx.TraceIdentifier, storageMode = "memory" });
            }

            if (memoryOrder.Checkout.State is "paid" or "declined")
            {
                return Results.Ok(new
                {
                    ok = memoryOrder.Checkout.State == "paid",
                    replay = true,
                    reconciled = false,
                    orderId = memoryOrder.OrderId,
                    payment = memoryOrder.Checkout.State,
                    checkoutState = memoryOrder.Checkout.State,
                    submitState = memoryOrder.Checkout.SubmitState,
                    memoryOrder.Checkout.ReferenceNumber,
                    memoryOrder.Checkout.TransactionId,
                    traceId = ctx.TraceIdentifier,
                    storageMode = "memory",
                    storageWarning
                });
            }

            var gateway = ZcreditGatewayFactory.Create(config, log);
            var gatewayResult = await gateway.ReconcileAsync(new GatewayReconcileRequest(
                MiniAppId: req.MiniAppId,
                OrderId: memoryOrder.OrderId,
                Amount: memoryOrder.Amount,
                IdempotencyKey: idempotencyKey,
                ReferenceNumber: memoryOrder.Checkout.ReferenceNumber,
                TransactionId: memoryOrder.Checkout.TransactionId), ct);

            var reconciled = memoryOrder with
            {
                Status = gatewayResult.CheckoutState == "paid" ? 1 : 0,
                PaymentMethod = gatewayResult.CheckoutState == "paid" ? "card" : "unpaid",
                UpdatedAtUtc = DateTime.UtcNow,
                Checkout = memoryOrder.Checkout with
                {
                    State = gatewayResult.CheckoutState,
                    SubmitState = gatewayResult.CheckoutState == "paid" && SubmitOrderHelper.ResolveMode(config, app.Environment) != "off"
                        ? "done"
                        : memoryOrder.Checkout.SubmitState,
                    ReferenceNumber = gatewayResult.ReferenceNumber ?? memoryOrder.Checkout.ReferenceNumber,
                    TransactionId = gatewayResult.TransactionId ?? memoryOrder.Checkout.TransactionId,
                    ReturnCode = gatewayResult.ReturnCode,
                    ReturnMessage = gatewayResult.ReturnMessage
                }
            };
            memoryCheckoutStore[memoryKey] = reconciled;

            return gatewayResult.CheckoutState switch
            {
                "paid" => Results.Ok(new
                {
                    ok = true,
                    reconciled = true,
                    orderId = reconciled.OrderId,
                    payment = reconciled.Checkout.State,
                    checkoutState = reconciled.Checkout.State,
                    submitState = reconciled.Checkout.SubmitState,
                    reconciled.Checkout.ReferenceNumber,
                    reconciled.Checkout.TransactionId,
                    traceId = ctx.TraceIdentifier,
                    storageMode = "memory",
                    storageWarning
                }),
                "declined" => Results.Json(new
                {
                    ok = false,
                    reconciled = true,
                    orderId = reconciled.OrderId,
                    payment = reconciled.Checkout.State,
                    checkoutState = reconciled.Checkout.State,
                    submitState = reconciled.Checkout.SubmitState,
                    reconciled.Checkout.ReferenceNumber,
                    reconciled.Checkout.TransactionId,
                    traceId = ctx.TraceIdentifier,
                    storageMode = "memory",
                    storageWarning
                }, statusCode: 402),
                _ => Results.Json(new
                {
                    ok = false,
                    reconciled = true,
                    orderId = reconciled.OrderId,
                    payment = reconciled.Checkout.State,
                    checkoutState = reconciled.Checkout.State,
                    submitState = reconciled.Checkout.SubmitState,
                    reconciled.Checkout.ReferenceNumber,
                    reconciled.Checkout.TransactionId,
                    traceId = ctx.TraceIdentifier,
                    storageMode = "memory",
                    storageWarning
                }, statusCode: 202)
            };
        }

        async Task<IResult> RunMemoryReconcileAsync(string? warning)
        {
            var memoryKey = BuildMemoryKey(req.MiniAppId, idempotencyKey);
            if (!memoryCheckoutStore.TryGetValue(memoryKey, out var memoryOrder))
            {
                return Results.NotFound(new { ok = false, error = "Order not found", traceId = ctx.TraceIdentifier, storageMode = "memory" });
            }

            if (memoryOrder.Checkout.State is "paid" or "declined")
            {
                return Results.Ok(new
                {
                    ok = memoryOrder.Checkout.State == "paid",
                    replay = true,
                    reconciled = false,
                    orderId = memoryOrder.OrderId,
                    payment = memoryOrder.Checkout.State,
                    checkoutState = memoryOrder.Checkout.State,
                    submitState = memoryOrder.Checkout.SubmitState,
                    memoryOrder.Checkout.ReferenceNumber,
                    memoryOrder.Checkout.TransactionId,
                    traceId = ctx.TraceIdentifier,
                    storageMode = "memory",
                    storageWarning = warning
                });
            }

            var gateway = ZcreditGatewayFactory.Create(config, log);
            var gatewayResult = await gateway.ReconcileAsync(new GatewayReconcileRequest(
                MiniAppId: req.MiniAppId,
                OrderId: memoryOrder.OrderId,
                Amount: memoryOrder.Amount,
                IdempotencyKey: idempotencyKey,
                ReferenceNumber: memoryOrder.Checkout.ReferenceNumber,
                TransactionId: memoryOrder.Checkout.TransactionId), ct);

            var reconciled = memoryOrder with
            {
                Status = gatewayResult.CheckoutState == "paid" ? 1 : 0,
                PaymentMethod = gatewayResult.CheckoutState == "paid" ? "card" : "unpaid",
                UpdatedAtUtc = DateTime.UtcNow,
                Checkout = memoryOrder.Checkout with
                {
                    State = gatewayResult.CheckoutState,
                    SubmitState = gatewayResult.CheckoutState == "paid" && SubmitOrderHelper.ResolveMode(config, app.Environment) != "off"
                        ? "done"
                        : memoryOrder.Checkout.SubmitState,
                    ReferenceNumber = gatewayResult.ReferenceNumber ?? memoryOrder.Checkout.ReferenceNumber,
                    TransactionId = gatewayResult.TransactionId ?? memoryOrder.Checkout.TransactionId,
                    ReturnCode = gatewayResult.ReturnCode,
                    ReturnMessage = gatewayResult.ReturnMessage
                }
            };
            memoryCheckoutStore[memoryKey] = reconciled;

            return gatewayResult.CheckoutState switch
            {
                "paid" => Results.Ok(new
                {
                    ok = true,
                    reconciled = true,
                    orderId = reconciled.OrderId,
                    payment = reconciled.Checkout.State,
                    checkoutState = reconciled.Checkout.State,
                    submitState = reconciled.Checkout.SubmitState,
                    reconciled.Checkout.ReferenceNumber,
                    reconciled.Checkout.TransactionId,
                    traceId = ctx.TraceIdentifier,
                    storageMode = "memory",
                    storageWarning = warning
                }),
                "declined" => Results.Json(new
                {
                    ok = false,
                    reconciled = true,
                    orderId = reconciled.OrderId,
                    payment = reconciled.Checkout.State,
                    checkoutState = reconciled.Checkout.State,
                    submitState = reconciled.Checkout.SubmitState,
                    reconciled.Checkout.ReferenceNumber,
                    reconciled.Checkout.TransactionId,
                    traceId = ctx.TraceIdentifier,
                    storageMode = "memory",
                    storageWarning = warning
                }, statusCode: 402),
                _ => Results.Json(new
                {
                    ok = false,
                    reconciled = true,
                    orderId = reconciled.OrderId,
                    payment = reconciled.Checkout.State,
                    checkoutState = reconciled.Checkout.State,
                    submitState = reconciled.Checkout.SubmitState,
                    reconciled.Checkout.ReferenceNumber,
                    reconciled.Checkout.TransactionId,
                    traceId = ctx.TraceIdentifier,
                    storageMode = "memory",
                    storageWarning = warning
                }, statusCode: 202)
            };
        }

        if (conn is null)
        {
            return await RunMemoryReconcileAsync(storageWarning);
        }

        await using (conn)
        {
        try
        {

        const string findSql = """
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
    JSON_VALUE(Metadata, '$.checkout.submitState') AS SubmitState,
    JSON_VALUE(Metadata, '$.checkout.referenceNumber') AS ReferenceNumber,
    JSON_VALUE(Metadata, '$.checkout.transactionId') AS TransactionId,
    JSON_VALUE(Metadata, '$.checkout.returnCode') AS ReturnCode,
    JSON_VALUE(Metadata, '$.checkout.returnMessage') AS ReturnMessage
FROM dbo.Orders
WHERE MiniAppId = @MiniAppId
  AND IdempotencyKeyRaw = @IdempotencyKey
ORDER BY Id DESC;
""";

        await using var cmd = new SqlCommand(findSql, conn);
        cmd.Parameters.AddWithValue("@MiniAppId", req.MiniAppId);
        cmd.Parameters.AddWithValue("@IdempotencyKey", idempotencyKey);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return Results.NotFound(new { ok = false, error = "Order not found", traceId = ctx.TraceIdentifier });
        }

        var orderId = reader.GetInt32(reader.GetOrdinal("Id"));
        var amount = reader.GetDecimal(reader.GetOrdinal("Total"));
        var state = reader.IsDBNull(reader.GetOrdinal("CheckoutState")) ? "unknown" : reader.GetString(reader.GetOrdinal("CheckoutState"));
        var submitState = reader.IsDBNull(reader.GetOrdinal("SubmitState")) ? "not_started" : reader.GetString(reader.GetOrdinal("SubmitState"));
        var referenceNumber = reader.IsDBNull(reader.GetOrdinal("ReferenceNumber")) ? null : reader.GetString(reader.GetOrdinal("ReferenceNumber"));
        var transactionId = reader.IsDBNull(reader.GetOrdinal("TransactionId")) ? null : reader.GetString(reader.GetOrdinal("TransactionId"));
        var metadataJson = reader.GetString(reader.GetOrdinal("MetadataJson"));
        await reader.DisposeAsync();

        if (state == "paid" && submitState != "done" && SubmitOrderHelper.ResolveMode(config, app.Environment) != "off")
        {
            var extractedOrder = SubmitOrderHelper.TryExtractOrder(metadataJson);
            var submitResult = extractedOrder is null
                ? new SubmitOrderAttemptResult("failed", null, null, null, "Could not extract order payload from checkout metadata", DateTime.UtcNow)
                : await SubmitOrderHelper.SubmitAsync(
                    httpFactory,
                    config,
                    log,
                    app.Environment,
                    extractedOrder,
                    req.MiniAppId,
                    orderId,
                    amount,
                    "ILS",
                    idempotencyKey,
                    null,
                    "01",
                    new GatewayResult(state, referenceNumber, transactionId, null, null),
                    ct);

            var existingMetadataNode = JsonNode.Parse(metadataJson) as JsonObject ?? new JsonObject();
            SubmitOrderHelper.ApplySubmitResult(existingMetadataNode, submitResult);
            var replayMetadataJson = existingMetadataNode.ToJsonString();

            const string replaySubmitSql = """
UPDATE dbo.Orders
SET
    Metadata = @Metadata,
    UpdatedAt = SYSUTCDATETIME()
WHERE Id = @Id;
""";

            await using var replaySubmitUpdate = new SqlCommand(replaySubmitSql, conn);
            replaySubmitUpdate.Parameters.AddWithValue("@Id", orderId);
            replaySubmitUpdate.Parameters.AddWithValue("@Metadata", replayMetadataJson);
            await replaySubmitUpdate.ExecuteNonQueryAsync(ct);
            submitState = submitResult.SubmitState;
        }

        if (state is "paid" or "declined")
        {
            return Results.Ok(new
            {
                ok = true,
                replay = true,
                reconciled = false,
                orderId,
                payment = state,
                checkoutState = state,
                submitState,
                referenceNumber,
                transactionId,
                traceId = ctx.TraceIdentifier,
                storageMode = "sql"
            });
        }

        var gateway = ZcreditGatewayFactory.Create(config, log);
        var gatewayResult = await gateway.ReconcileAsync(new GatewayReconcileRequest(
            MiniAppId: req.MiniAppId,
            OrderId: orderId,
            Amount: amount,
            IdempotencyKey: idempotencyKey,
            ReferenceNumber: referenceNumber,
            TransactionId: transactionId), ct);

        var metadataNode = JsonNode.Parse(metadataJson) as JsonObject ?? new JsonObject();
        var checkoutNode = metadataNode["checkout"] as JsonObject ?? new JsonObject();
        metadataNode["checkout"] = checkoutNode;
        checkoutNode["state"] = gatewayResult.CheckoutState;
        checkoutNode["submitState"] = submitState;
        checkoutNode["referenceNumber"] = gatewayResult.ReferenceNumber;
        checkoutNode["transactionId"] = gatewayResult.TransactionId;
        checkoutNode["returnCode"] = gatewayResult.ReturnCode;
        checkoutNode["returnMessage"] = gatewayResult.ReturnMessage;
        checkoutNode["updatedAtUtc"] = DateTime.UtcNow.ToString("O");
        var updatedMetadataJson = metadataNode.ToJsonString();

        const string updateSql = """
UPDATE dbo.Orders
SET
    Status = @Status,
    PaymentMethod = @PaymentMethod,
    PaymentReference = @PaymentReference,
    PaymentApprovedAtUtc = @PaymentApprovedAtUtc,
    Metadata = @Metadata,
    UpdatedAt = SYSUTCDATETIME()
WHERE Id = @Id;
""";

        await using var update = new SqlCommand(updateSql, conn);
        update.Parameters.AddWithValue("@Id", orderId);
        update.Parameters.AddWithValue("@Status", gatewayResult.CheckoutState == "paid" ? 1 : 0);
        update.Parameters.AddWithValue("@PaymentMethod", gatewayResult.CheckoutState == "paid" ? "card" : "unpaid");
        update.Parameters.AddWithValue("@PaymentReference", (object?)gatewayResult.ReferenceNumber ?? DBNull.Value);
        update.Parameters.AddWithValue("@PaymentApprovedAtUtc", gatewayResult.CheckoutState == "paid" ? DateTime.UtcNow : DBNull.Value);
        update.Parameters.AddWithValue("@Metadata", updatedMetadataJson);
        await update.ExecuteNonQueryAsync(ct);

        var finalSubmitState = submitState;
        if (gatewayResult.CheckoutState == "paid")
        {
            var extractedOrder = SubmitOrderHelper.TryExtractOrder(metadataJson);
            var submitResult = extractedOrder is null
                ? new SubmitOrderAttemptResult("failed", null, null, null, "Could not extract order payload from checkout metadata", DateTime.UtcNow)
                : await SubmitOrderHelper.SubmitAsync(
                    httpFactory,
                    config,
                    log,
                    app.Environment,
                    extractedOrder,
                    req.MiniAppId,
                    orderId,
                    amount,
                    "ILS",
                    idempotencyKey,
                    null,
                    "01",
                    gatewayResult,
                    ct);

            finalSubmitState = submitResult.SubmitState;
            SubmitOrderHelper.ApplySubmitResult(metadataNode, submitResult);

            await using var submitUpdate = new SqlCommand(updateSql, conn);
            submitUpdate.Parameters.AddWithValue("@Id", orderId);
            submitUpdate.Parameters.AddWithValue("@Status", gatewayResult.CheckoutState == "paid" ? 1 : 0);
            submitUpdate.Parameters.AddWithValue("@PaymentMethod", gatewayResult.CheckoutState == "paid" ? "card" : "unpaid");
            submitUpdate.Parameters.AddWithValue("@PaymentReference", (object?)gatewayResult.ReferenceNumber ?? DBNull.Value);
            submitUpdate.Parameters.AddWithValue("@PaymentApprovedAtUtc", gatewayResult.CheckoutState == "paid" ? DateTime.UtcNow : DBNull.Value);
            submitUpdate.Parameters.AddWithValue("@Metadata", metadataNode.ToJsonString());
            await submitUpdate.ExecuteNonQueryAsync(ct);
        }

        return gatewayResult.CheckoutState switch
        {
            "paid" => Results.Ok(new
            {
                ok = true,
                reconciled = true,
                orderId,
                payment = gatewayResult.CheckoutState,
                checkoutState = gatewayResult.CheckoutState,
                submitState = finalSubmitState,
                gatewayResult.ReferenceNumber,
                gatewayResult.TransactionId,
                traceId = ctx.TraceIdentifier,
                storageMode = "sql"
            }),
            "declined" => Results.Json(new
            {
                ok = false,
                reconciled = true,
                orderId,
                payment = gatewayResult.CheckoutState,
                checkoutState = gatewayResult.CheckoutState,
                submitState = finalSubmitState,
                gatewayResult.ReferenceNumber,
                gatewayResult.TransactionId,
                traceId = ctx.TraceIdentifier,
                storageMode = "sql"
            }, statusCode: 402),
            _ => Results.Json(new
            {
                ok = false,
                reconciled = true,
                orderId,
                payment = gatewayResult.CheckoutState,
                checkoutState = gatewayResult.CheckoutState,
                submitState = finalSubmitState,
                gatewayResult.ReferenceNumber,
                gatewayResult.TransactionId,
                traceId = ctx.TraceIdentifier,
                storageMode = "sql"
            }, statusCode: 202)
        };
        }
        catch (SqlException ex) when (allowMemoryFallback && ex.Number == 208)
        {
            storageWarning = $"SQL schema unavailable, using memory fallback: {ex.Message}";
            log.LogWarning(ex,
                "Checkout reconcile SQL schema missing, falling back to memory miniAppId={MiniAppId} idem={Idem} trace={Trace}",
                req.MiniAppId, idempotencyKey, ctx.TraceIdentifier);
            return await RunMemoryReconcileAsync(storageWarning);
        }
        }
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Checkout reconcile failed trace={Trace}", ctx.TraceIdentifier);
        return Results.Json(new
        {
            ok = false,
            error = ex.Message,
            type = ex.GetType().FullName,
            traceId = ctx.TraceIdentifier
        }, statusCode: 500);
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

internal record CheckoutReconcileRequest(
    int MiniAppId,
    string IdempotencyKey);

internal record CheckoutOrderPayload(
    int MiniAppId,
    int? CustomerId,
    string? UUID,
    string? Email,
    string? Name,
    string? Source,
    List<CheckoutBasketItem>? Basket,
    string? IdempotencyKey,
    string? DiningMode = null,
    string? Service = null,
    JsonElement? Totals = null,
    JsonElement? Device = null,
    JsonElement? Notifications = null,
    JsonElement? Delivery = null,
    JsonElement? Payment = null,
    int? TicketNumber = null,
    string? OrderType = null,
    string? TabKey = null);

internal sealed class CheckoutBasketItem
{
    [JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    public int? ProductId { get; init; }

    public string? Name { get; init; }

    [JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    public int Quantity { get; init; }

    [JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    public decimal Price { get; init; }

    public string? Modifiers { get; init; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtraFields { get; init; }

    public decimal ResolveUnitPrice()
    {
        if (Price > 0)
        {
            return Price;
        }

        return ReadDecimal("unitPrice")
            ?? ReadDecimal("unitTotalPrice")
            ?? ReadDecimal("unitBasePrice")
            ?? ((ReadDecimal("lineTotal") is decimal lineTotal && Quantity > 0)
                ? (decimal?)Math.Round(lineTotal / Quantity, 2, MidpointRounding.AwayFromZero)
                : null)
            ?? 0m;
    }

    public decimal ResolveLineTotal()
    {
        var unitPrice = ResolveUnitPrice();
        return ReadDecimal("lineTotal") ?? (unitPrice * Math.Max(Quantity, 0));
    }

    private decimal? ReadDecimal(string name)
    {
        if (ExtraFields is null || !ExtraFields.TryGetValue(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
            JsonValueKind.String when decimal.TryParse(
                value.GetString(),
                System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture,
                out var parsed) => parsed,
            _ => null
        };
    }
}

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
    string SubmitState,
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
    string SubmitState,
    string? ReferenceNumber,
    string? TransactionId,
    string? ReturnCode,
    string? ReturnMessage);

internal record GatewayCommitRequest(
    int MiniAppId,
    int OrderId,
    decimal Amount,
    string Currency,
    string IdempotencyKey,
    string TransactionType,
    string? PinpadId,
    string? DebugOutcome);

internal record GatewayReconcileRequest(
    int MiniAppId,
    int OrderId,
    decimal Amount,
    string IdempotencyKey,
    string? ReferenceNumber,
    string? TransactionId);

internal record GatewayResult(
    string CheckoutState,
    string? ReferenceNumber,
    string? TransactionId,
    string? ReturnCode,
    string? ReturnMessage);

internal record SubmitOrderAttemptResult(
    string SubmitState,
    int? SubmittedOrderId,
    bool? Replay,
    int? HttpStatus,
    string? Error,
    DateTime AttemptedAtUtc);

internal interface IZcreditGateway
{
    Task<GatewayResult> CommitAsync(GatewayCommitRequest request, CancellationToken ct);
    Task<GatewayResult> ReconcileAsync(GatewayReconcileRequest request, CancellationToken ct);
}

internal static class SubmitOrderHelper
{
    public static string ResolveMode(IConfiguration config, IHostEnvironment env)
    {
        var configured = (config["CheckoutDebug:SubmitMode"] ?? "").Trim().ToLowerInvariant();
        if (configured is "off" or "fake" or "real")
        {
            return configured;
        }

        return env.IsDevelopment() ? "fake" : "real";
    }

    public static CheckoutOrderPayload? TryExtractOrder(string metadataJson)
    {
        try
        {
            var root = JsonNode.Parse(metadataJson) as JsonObject;
            var orderNode = root?["order"];
            return orderNode is null
                ? null
                : JsonSerializer.Deserialize<CheckoutOrderPayload>(orderNode.ToJsonString());
        }
        catch
        {
            return null;
        }
    }

    public static void ApplySubmitResult(JsonObject metadataNode, SubmitOrderAttemptResult result)
    {
        var checkoutNode = metadataNode["checkout"] as JsonObject ?? new JsonObject();
        metadataNode["checkout"] = checkoutNode;
        checkoutNode["submitState"] = result.SubmitState;

        var submitNode = metadataNode["submit"] as JsonObject ?? new JsonObject();
        metadataNode["submit"] = submitNode;
        submitNode["state"] = result.SubmitState;
        submitNode["orderId"] = result.SubmittedOrderId;
        submitNode["replay"] = result.Replay;
        submitNode["httpStatus"] = result.HttpStatus;
        submitNode["error"] = result.Error;
        submitNode["attemptedAtUtc"] = result.AttemptedAtUtc.ToString("O");
    }

    public static async Task<SubmitOrderAttemptResult> SubmitAsync(
        IHttpClientFactory httpFactory,
        IConfiguration config,
        ILogger log,
        IHostEnvironment env,
        CheckoutOrderPayload order,
        int miniAppId,
        int checkoutOrderId,
        decimal amount,
        string currency,
        string idempotencyKey,
        string? pinpadId,
        string transactionType,
        GatewayResult gatewayResult,
        CancellationToken ct)
    {
        var mode = ResolveMode(config, env);
        var attemptedAtUtc = DateTime.UtcNow;

        if (mode == "off")
        {
            return new SubmitOrderAttemptResult("not_started", null, null, null, null, attemptedAtUtc);
        }

        if (mode == "fake")
        {
            log.LogInformation(
                "Fake submitOrder miniAppId={MiniAppId} checkoutOrderId={CheckoutOrderId} idem={Idem}",
                miniAppId, checkoutOrderId, idempotencyKey);
            return new SubmitOrderAttemptResult("done", checkoutOrderId + 500000, false, 200, null, attemptedAtUtc);
        }

        var url = (config["CheckoutDebug:SubmitOrderUrl"] ?? "https://minis.studio/submitOrder").Trim();
        if (string.IsNullOrWhiteSpace(url))
        {
            return new SubmitOrderAttemptResult("failed", null, null, null, "Missing CheckoutDebug:SubmitOrderUrl", attemptedAtUtc);
        }

        var payload = BuildSubmitPayload(order, miniAppId, amount, currency, idempotencyKey, pinpadId, transactionType, gatewayResult);
        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(payload.ToJsonString(), System.Text.Encoding.UTF8, "application/json")
        };
        var source = NormalizeSource(order.Source);
        req.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
        req.Headers.TryAddWithoutValidation("X-Request-Id", idempotencyKey);
        req.Headers.TryAddWithoutValidation("X-Order-Source", source);

        try
        {
            var client = httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(30);
            using var response = await client.SendAsync(req, ct);
            var body = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                log.LogWarning(
                    "submitOrder failed miniAppId={MiniAppId} checkoutOrderId={CheckoutOrderId} status={Status}",
                    miniAppId, checkoutOrderId, (int)response.StatusCode);
                return new SubmitOrderAttemptResult("failed", null, null, (int)response.StatusCode, body, attemptedAtUtc);
            }

            int? submittedOrderId = null;
            bool? replay = null;
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.TryGetProperty("orderId", out var orderIdProp) && orderIdProp.TryGetInt32(out var parsedOrderId))
                {
                    submittedOrderId = parsedOrderId;
                }

                if (root.TryGetProperty("replay", out var replayProp) &&
                    (replayProp.ValueKind == JsonValueKind.True || replayProp.ValueKind == JsonValueKind.False))
                {
                    replay = replayProp.GetBoolean();
                }
            }
            catch
            {
            }

            return submittedOrderId.HasValue && submittedOrderId.Value > 0
                ? new SubmitOrderAttemptResult("done", submittedOrderId, replay, (int)response.StatusCode, null, attemptedAtUtc)
                : new SubmitOrderAttemptResult("failed", null, replay, (int)response.StatusCode, "submitOrder succeeded but returned no orderId", attemptedAtUtc);
        }
        catch (Exception ex)
        {
            log.LogError(ex,
                "submitOrder exception miniAppId={MiniAppId} checkoutOrderId={CheckoutOrderId}",
                miniAppId, checkoutOrderId);
            return new SubmitOrderAttemptResult("failed", null, null, null, ex.Message, attemptedAtUtc);
        }
    }

    private static JsonObject BuildSubmitPayload(
        CheckoutOrderPayload order,
        int miniAppId,
        decimal amount,
        string currency,
        string idempotencyKey,
        string? pinpadId,
        string transactionType,
        GatewayResult gatewayResult)
    {
        var source = NormalizeSource(order.Source);
        var payload = new JsonObject
        {
            ["uuid"] = string.IsNullOrWhiteSpace(order.UUID) ? Guid.NewGuid().ToString() : order.UUID,
            ["email"] = string.IsNullOrWhiteSpace(order.Email) ? "customer@example.com" : order.Email,
            ["name"] = string.IsNullOrWhiteSpace(order.Name) ? "Customer" : order.Name,
            ["miniAppId"] = miniAppId,
            ["total"] = amount,
            ["source"] = source,
            ["orderSource"] = source,
            ["idempotencyKey"] = idempotencyKey,
            ["basket"] = BuildBasket(order.Basket),
            ["service"] = string.IsNullOrWhiteSpace(order.Service) ? InferService(order.DiningMode) : order.Service,
            ["totals"] = CloneNode(order.Totals) ?? new JsonObject
            {
                ["total"] = amount,
                ["subtotal"] = amount,
                ["discount"] = 0,
                ["currency"] = currency
            },
            ["payment"] = CloneNode(order.Payment) ?? new JsonObject
            {
                ["provider"] = "zcredit",
                ["method"] = "card",
                ["cardAmount"] = amount,
                ["cashAmount"] = 0
            },
            ["zcredit"] = new JsonObject
            {
                ["provider"] = "zcredit",
                ["method"] = "card",
                ["referenceNumber"] = gatewayResult.ReferenceNumber,
                ["transactionId"] = gatewayResult.TransactionId,
                ["returnCode"] = gatewayResult.ReturnCode,
                ["returnMessage"] = gatewayResult.ReturnMessage,
                ["pinpadId"] = pinpadId,
                ["transactionType"] = transactionType
            }
        };

        if (!string.IsNullOrWhiteSpace(order.DiningMode))
        {
            payload["diningMode"] = order.DiningMode;
        }

        if (CloneNode(order.Device) is JsonNode deviceNode)
        {
            payload["device"] = deviceNode;
        }

        if (CloneNode(order.Notifications) is JsonNode notificationsNode)
        {
            payload["notifications"] = notificationsNode;
        }

        if (CloneNode(order.Delivery) is JsonNode deliveryNode)
        {
            payload["delivery"] = deliveryNode;
        }

        if (order.TicketNumber.HasValue)
        {
            payload["ticketNumber"] = order.TicketNumber.Value;
        }

        if (!string.IsNullOrWhiteSpace(order.OrderType))
        {
            payload["orderType"] = order.OrderType;
        }

        if (!string.IsNullOrWhiteSpace(order.TabKey))
        {
            payload["tabKey"] = order.TabKey;
        }

        return payload;
    }

    private static JsonArray BuildBasket(List<CheckoutBasketItem>? basket)
    {
        var arr = new JsonArray();
        if (basket is null)
        {
            return arr;
        }

        for (var i = 0; i < basket.Count; i++)
        {
            var item = basket[i];
            var quantity = Math.Max(item.Quantity, 0);
            var unitPrice = item.ResolveUnitPrice();
            var lineTotal = item.ResolveLineTotal();
            arr.Add(new JsonObject
            {
                ["lineId"] = i + 1,
                ["productId"] = item.ProductId,
                ["name"] = item.Name,
                ["quantity"] = quantity,
                ["unitPrice"] = unitPrice,
                ["lineTotal"] = lineTotal,
                ["modifiers"] = item.Modifiers ?? "",
                ["isOth"] = false
            });
        }

        return arr;
    }

    private static JsonNode? CloneNode(JsonElement? value) =>
        !value.HasValue || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
            ? null
            : JsonNode.Parse(value.Value.GetRawText());

    private static string NormalizeSource(string? raw)
    {
        return "cashpoint";
    }

    private static string InferService(string? diningMode)
    {
        var normalized = (diningMode ?? "").Trim().ToLowerInvariant();
        return normalized is "takeaway" or "ta" ? "ta" : "sit";
    }
}

internal static class ZcreditGatewayFactory
{
    public static IZcreditGateway Create(IConfiguration config, ILogger log)
    {
        var mode = (config["CheckoutDebug:GatewayMode"] ?? "fake").Trim().ToLowerInvariant();
        return mode == "real"
            ? new RealZcreditGateway(config, log)
            : new FakeZcreditGateway(log);
    }
}

internal sealed class FakeZcreditGateway(ILogger log) : IZcreditGateway
{
    public Task<GatewayResult> CommitAsync(GatewayCommitRequest request, CancellationToken ct)
    {
        var outcome = NormalizeOutcome(request.DebugOutcome);
        var result = BuildResult(outcome, request.OrderId);
        log.LogInformation(
            "Fake gateway commit miniAppId={MiniAppId} orderId={OrderId} idem={Idem} state={State}",
            request.MiniAppId, request.OrderId, request.IdempotencyKey, result.CheckoutState);
        return Task.FromResult(result);
    }

    public Task<GatewayResult> ReconcileAsync(GatewayReconcileRequest request, CancellationToken ct)
    {
        var result = request.ReferenceNumber is not null || request.TransactionId is not null
            ? new GatewayResult("paid", request.ReferenceNumber, request.TransactionId, "0", "Reconciled from saved identifiers")
            : new GatewayResult("unknown", null, null, "CommitHttpError", "No saved identifiers to reconcile");
        log.LogInformation(
            "Fake gateway reconcile miniAppId={MiniAppId} orderId={OrderId} idem={Idem} state={State}",
            request.MiniAppId, request.OrderId, request.IdempotencyKey, result.CheckoutState);
        return Task.FromResult(result);
    }

    private static string NormalizeOutcome(string? raw)
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

    private static GatewayResult BuildResult(string outcome, int orderId) =>
        outcome switch
        {
            "approved" => new GatewayResult("paid", $"REF-{orderId}", $"TX-{orderId}", "0", "Approved"),
            "declined" => new GatewayResult("declined", null, null, "1001", "Declined"),
            "pending" => new GatewayResult("pending", $"REF-{orderId}", null, "-80", "Pending confirmation"),
            "unknown" => new GatewayResult("unknown", null, null, "CommitHttpError", "Gateway response unknown"),
            _ => new GatewayResult("paid", $"REF-{orderId}", $"TX-{orderId}", "0", "Approved")
        };
}

internal sealed class RealZcreditGateway(IConfiguration config, ILogger log) : IZcreditGateway
{
    public async Task<GatewayResult> CommitAsync(GatewayCommitRequest request, CancellationToken ct)
    {
        // This is intentionally config-driven and conservative so we can finish the
        // integration before we have the physical terminal in hand.
        var baseUrl = config["ZCredit:BaseUrl"];
        var terminal = config["ZCredit:TerminalNumber"];
        var password = config["ZCredit:Password"];
        var pinpad = string.IsNullOrWhiteSpace(request.PinpadId) ? config["ZCredit:PinpadId"] : request.PinpadId;

        if (string.IsNullOrWhiteSpace(baseUrl) ||
            string.IsNullOrWhiteSpace(terminal) ||
            string.IsNullOrWhiteSpace(password) ||
            string.IsNullOrWhiteSpace(pinpad))
        {
            throw new InvalidOperationException("Real gateway mode requires ZCredit:BaseUrl, TerminalNumber, Password, and PinpadId.");
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var payload = new
        {
            TerminalNumber = terminal,
            Password = password,
            TransactionSum = request.Amount,
            Track2 = $"PINPAD{pinpad}",
            TransactionUniqueID = request.IdempotencyKey,
            UseAdvancedDuplicatesCheck = true,
            CoinID = request.Currency == "ILS" ? "376" : request.Currency,
            TransactionType = request.TransactionType
        };

        var response = await http.PostAsJsonAsync($"{baseUrl.TrimEnd('/')}/Transaction/CommitFullTransaction", payload, ct);
        var text = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
        {
            log.LogWarning("Real gateway commit http={Status} body={Body}", (int)response.StatusCode, text);
            return new GatewayResult("unknown", null, null, $"HTTP{(int)response.StatusCode}", text);
        }

        using var doc = JsonDocument.Parse(text);
        var root = doc.RootElement;
        var returnCode = JsonFlex(root, "ReturnCode");
        var returnMessage = JsonFlex(root, "ReturnMessage");
        var referenceNumber = JsonFlex(root, "ReferenceNumber");
        var transactionId = JsonFlex(root, "TransactionId");
        var hasError = JsonBool(root, "HasError");
        var isApproved = JsonBool(root, "IsApproved") || returnCode == "0";
        var state = hasError
            ? (returnCode is "-80" or "-50101" ? "pending" : "declined")
            : (isApproved ? "paid" : "unknown");

        return new GatewayResult(state, referenceNumber, transactionId, returnCode, returnMessage);
    }

    public Task<GatewayResult> ReconcileAsync(GatewayReconcileRequest request, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(request.ReferenceNumber) || !string.IsNullOrWhiteSpace(request.TransactionId))
        {
            return Task.FromResult(new GatewayResult("paid", request.ReferenceNumber, request.TransactionId, "0", "Reconciled from saved payment identifiers"));
        }

        return Task.FromResult(new GatewayResult("unknown", null, null, "NoReference", "Missing reference for reconciliation"));
    }

    private static string? JsonFlex(JsonElement root, string name) =>
        root.TryGetProperty(name, out var p)
            ? p.ValueKind switch
            {
                JsonValueKind.String => p.GetString(),
                JsonValueKind.Number => p.ToString(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => p.ToString()
            }
            : null;

    private static bool JsonBool(JsonElement root, string name) =>
        root.TryGetProperty(name, out var p)
            && p.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Number => p.ToString() != "0",
                JsonValueKind.String => bool.TryParse(p.GetString(), out var b) && b,
                _ => false
            };
}
