WITH d AS (
    SELECT CAST(CreatedAt AS date) AS DayDate, Id
    FROM Orders
    WHERE CreatedAt >= DATEADD(day, -7, GETDATE())
      AND Status > 0
),
joined AS (
    SELECT d.DayDate, d.Id AS OrderId, oi.Id AS OrderItemId
    FROM d
    LEFT JOIN OrderItems oi ON oi.OrderId = d.Id
)
SELECT
    DayDate,
    COUNT(DISTINCT OrderId) AS OrdersCount,
    COUNT(OrderItemId) AS OrderItemsCount,
    COUNT(DISTINCT CASE WHEN OrderItemId IS NOT NULL THEN OrderId END) AS OrdersWithItems
FROM joined
GROUP BY DayDate
ORDER BY DayDate DESC;
