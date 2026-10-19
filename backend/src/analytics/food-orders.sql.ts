// One statement supplies a consistent snapshot. Count orders before joining items.
export const FOOD_ORDERS_SQL = `
WITH calendar AS (
  SELECT date_trunc($1, $3::timestamptz AT TIME ZONE $2) AS local_start
), bounds AS (
  SELECT local_start, local_start + CASE $1 WHEN 'day' THEN interval '1 day'
    WHEN 'week' THEN interval '1 week' ELSE interval '1 month' END AS local_end FROM calendar
), period AS (
  SELECT *,local_start AT TIME ZONE $2 AS period_start,local_end AT TIME ZONE $2 AS period_end FROM bounds
), candidates AS MATERIALIZED (
  SELECT o.order_id,o.placed_at,o.status,o.updated_at FROM public.kms_food_orders o,period
  WHERE o.placed_at>=period_start AND o.placed_at<period_end
), orders AS MATERIALIZED (
  SELECT * FROM candidates WHERE status::text=ANY($4::text[])
), days AS (
  SELECT day::date AS date FROM period,LATERAL generate_series(local_start,local_end-interval '1 day',interval '1 day') day
), daily AS (
  SELECT (placed_at AT TIME ZONE $2)::date AS date,count(*) AS count FROM orders GROUP BY 1
), hourly AS (
  SELECT extract(hour FROM placed_at AT TIME ZONE $2)::int AS hour,count(*) AS count FROM orders GROUP BY 1
), ranked_items AS (
  SELECT i.menu_item_id AS id,i.name,sum(i.quantity)::text AS quantity
  FROM public.kms_food_order_items i JOIN orders o USING(order_id)
  GROUP BY i.menu_item_id,i.name
  ORDER BY sum(i.quantity) DESC,i.name COLLATE "C" ASC,i.menu_item_id ASC LIMIT 10
), freshness AS (
  SELECT greatest((SELECT max(updated_at) FROM candidates),
    (SELECT max(i.updated_at) FROM public.kms_food_order_items i JOIN candidates c USING(order_id))) AS source_updated_at
)
SELECT period_start,period_end,(SELECT count(*)::text FROM orders) AS total,
  (SELECT jsonb_agg(jsonb_build_object('date',to_char(days.date,'YYYY-MM-DD'),'count',coalesce(daily.count,0)::text) ORDER BY days.date)
    FROM days LEFT JOIN daily USING(date)) AS trend,
  (SELECT jsonb_agg(jsonb_build_object('hour',h,'count',coalesce(hourly.count,0)::text) ORDER BY h)
    FROM generate_series(0,23) h LEFT JOIN hourly ON hourly.hour=h) AS hours,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'quantity',quantity)
    ORDER BY quantity::numeric DESC,name COLLATE "C" ASC,id ASC) FROM ranked_items),'[]'::jsonb) AS items,
  source_updated_at,statement_timestamp() AS queried_at FROM period CROSS JOIN freshness
`;
