WITH y_orders AS (
    SELECT
        Id,
        Metadata
    FROM Orders
    WHERE CAST(CreatedAt AS date) = DATEADD(day, -1, CAST(GETDATE() AS date))
      AND Status > 0
      AND ISJSON(Metadata) = 1
),
y_items AS (
    SELECT
        o.Id AS OrderId,
        TRY_CONVERT(int, JSON_VALUE(j.value, '$.productId')) AS ProductId,
        COALESCE(NULLIF(JSON_VALUE(j.value, '$.name'), ''), CONCAT('Product #', JSON_VALUE(j.value, '$.productId'))) AS ProductName,
        COALESCE(
            TRY_CONVERT(int, JSON_VALUE(j.value, '$.quantity')),
            TRY_CONVERT(int, JSON_VALUE(j.value, '$.qty')),
            0
        ) AS Quantity
    FROM y_orders o
    CROSS APPLY OPENJSON(o.Metadata, '$.basket') j
),
agg AS (
    SELECT
        ProductId,
        ProductName,
        SUM(Quantity) AS TotalQuantity,
        COUNT(DISTINCT OrderId) AS OrdersContainingProduct
    FROM y_items
    WHERE Quantity > 0
    GROUP BY ProductId, ProductName
),
total AS (
    SELECT SUM(TotalQuantity) AS TotalSoldQty
    FROM agg
)
SELECT TOP 10
    ProductId,
    ProductName,
    TotalQuantity,
    OrdersContainingProduct,
    CAST(CASE WHEN t.TotalSoldQty = 0 THEN 0 ELSE 100.0 * TotalQuantity / t.TotalSoldQty END AS decimal(6,2)) AS SharePctOfYesterdayQty
FROM agg
CROSS JOIN total t
ORDER BY TotalQuantity DESC, ProductName ASC;
