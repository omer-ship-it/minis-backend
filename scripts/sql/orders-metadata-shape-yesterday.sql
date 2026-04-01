SELECT TOP 5
    Id,
    Status,
    CreatedAt,
    LEFT(Metadata, 1200) AS MetadataSample
FROM Orders
WHERE CAST(CreatedAt AS date) = DATEADD(day, -1, CAST(GETDATE() AS date))
  AND Status > 0
  AND ISJSON(Metadata) = 1
ORDER BY Id DESC;
