WITH y AS (
    SELECT
        CASE
            WHEN LOWER(LTRIM(RTRIM(COALESCE(Source, '')))) = 'mini' THEN 'mini'
            WHEN LOWER(LTRIM(RTRIM(COALESCE(Source, '')))) = 'cashpoint' THEN 'cashpoint'
            ELSE 'rest'
        END AS source_bucket
    FROM Orders
    WHERE CAST(CreatedAt AS date) = DATEADD(day, -1, CAST(GETDATE() AS date))
      AND Status > 0
),
agg AS (
    SELECT
        COUNT(*) AS total_orders,
        SUM(CASE WHEN source_bucket = 'mini' THEN 1 ELSE 0 END) AS mini_orders,
        SUM(CASE WHEN source_bucket = 'cashpoint' THEN 1 ELSE 0 END) AS cashpoint_orders,
        SUM(CASE WHEN source_bucket = 'rest' THEN 1 ELSE 0 END) AS rest_orders
    FROM y
)
SELECT
    total_orders,
    mini_orders,
    cashpoint_orders,
    rest_orders,
    CAST(CASE WHEN total_orders = 0 THEN 0 ELSE 100.0 * mini_orders / total_orders END AS decimal(5,2)) AS mini_pct,
    CAST(CASE WHEN total_orders = 0 THEN 0 ELSE 100.0 * cashpoint_orders / total_orders END AS decimal(5,2)) AS cashpoint_pct,
    CAST(CASE WHEN total_orders = 0 THEN 0 ELSE 100.0 * rest_orders / total_orders END AS decimal(5,2)) AS rest_pct
FROM agg;
