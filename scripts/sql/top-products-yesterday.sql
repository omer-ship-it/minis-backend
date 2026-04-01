WITH y_orders AS (
    SELECT Id
    FROM Orders
    WHERE CAST(CreatedAt AS date) = DATEADD(day, -1, CAST(GETDATE() AS date))
      AND Status > 0
),
y_items AS (
    SELECT
        oi.OrderId,
        oi.ProductId,
        COALESCE(NULLIF(p.Name, ''), NULLIF(oi.Name, ''), CONCAT('Product #', oi.ProductId)) AS ProductName,
        CAST(oi.Quantity AS int) AS Quantity
    FROM OrderItems oi
    INNER JOIN y_orders o ON o.Id = oi.OrderId
    LEFT JOIN Products p ON p.Id = oi.ProductId
),
agg AS (
    SELECT
        ProductId,
        ProductName,
        SUM(Quantity) AS TotalQuantity,
        COUNT(DISTINCT OrderId) AS OrdersContainingProduct
    FROM y_items
    GROUP BY ProductId, ProductName
),
total AS (
    SELECT SUM(TotalQuantity) AS TotalSoldQty
    FROM agg
)
SELECT TOP 10
    a.ProductId,
    a.ProductName,
    a.TotalQuantity,
    a.OrdersContainingProduct,
    CAST(CASE WHEN t.TotalSoldQty = 0 THEN 0 ELSE 100.0 * a.TotalQuantity / t.TotalSoldQty END AS decimal(6,2)) AS SharePctOfYesterdayQty
FROM agg a
CROSS JOIN total t
ORDER BY a.TotalQuantity DESC, a.ProductName ASC;
