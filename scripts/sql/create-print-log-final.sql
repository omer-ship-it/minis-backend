/*
Creates a durable final print report log with idempotent dedupe by dedupe_key.

Notes for investigation/query performance:
- PK on id for append-only inserts.
- Unique index on dedupe_key for idempotent writes.
- Index on order_id + created_at for per-order investigation.
- Index on created_at + final_status + station for recent operational triage.
*/

IF OBJECT_ID('dbo.print_log_final', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.print_log_final
    (
        id bigint IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_print_log_final PRIMARY KEY CLUSTERED,
        dedupe_key nvarchar(120) NOT NULL,
        order_id int NOT NULL,
        station nvarchar(64) NOT NULL,
        final_status nvarchar(32) NOT NULL,
        device_id nvarchar(128) NULL,
        app_version nvarchar(64) NULL,
        printer_host nvarchar(255) NULL,
        printer_port int NULL,
        started_at datetime2(3) NULL,
        finished_at datetime2(3) NULL,
        total_duration_ms int NULL,
        attempt_count int NOT NULL
            CONSTRAINT DF_print_log_final_attempt_count DEFAULT (0),
        attempts_json nvarchar(max) NULL,
        created_at datetime2(3) NOT NULL
            CONSTRAINT DF_print_log_final_created_at DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT UQ_print_log_final_dedupe_key UNIQUE NONCLUSTERED (dedupe_key),
        CONSTRAINT CK_print_log_final_printer_port
            CHECK (printer_port IS NULL OR (printer_port BETWEEN 1 AND 65535)),
        CONSTRAINT CK_print_log_final_total_duration_ms
            CHECK (total_duration_ms IS NULL OR total_duration_ms >= 0),
        CONSTRAINT CK_print_log_final_attempt_count
            CHECK (attempt_count >= 0),
        CONSTRAINT CK_print_log_final_attempts_json
            CHECK (attempts_json IS NULL OR ISJSON(attempts_json) = 1)
    );

    CREATE NONCLUSTERED INDEX IX_print_log_final_order_id_created_at
        ON dbo.print_log_final (order_id, created_at DESC);

    CREATE NONCLUSTERED INDEX IX_print_log_final_created_at_status_station
        ON dbo.print_log_final (created_at DESC, final_status, station)
        INCLUDE (order_id, device_id, app_version, printer_host, printer_port, attempt_count);
END;
