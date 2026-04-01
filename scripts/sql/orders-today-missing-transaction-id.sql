SELECT TOP 100
    Id,
    Status,
    CreatedAt,
    Metadata,
    JSON_VALUE(Metadata, '$.transactionId') AS TransactionId
FROM Orders
WHERE CAST(CreatedAt AS date) = CAST(GETDATE() AS date)
  AND (
        ISJSON(Metadata) = 0
        OR COALESCE(
            NULLIF(JSON_VALUE(Metadata, '$.transactionId'), ''),
            NULLIF(JSON_VALUE(Metadata, '$.TransactionId'), '')
        ) IS NULL
      )
ORDER BY Id DESC;
