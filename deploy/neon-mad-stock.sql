-- DDP-034: review and apply manually after the shared KMS schema. Never run at startup.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mad_stock_alerts (
 alert_id uuid PRIMARY KEY, menu_item_id uuid NOT NULL UNIQUE,
 item_name varchar(255) NOT NULL, stock_status text NOT NULL CHECK(stock_status IN ('AVAILABLE','LOW_STOCK','UNAVAILABLE','TEMPORARILY_DISABLED')),
 active boolean NOT NULL,version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
 source_updated_at timestamptz NOT NULL,raised_at timestamptz,cleared_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(active=(stock_status<>'AVAILABLE')),
 CHECK(NOT active OR (raised_at IS NOT NULL AND cleared_at IS NULL))
);
CREATE INDEX IF NOT EXISTS mad_stock_alerts_active_idx ON public.mad_stock_alerts(updated_at,menu_item_id) WHERE active;
CREATE TABLE IF NOT EXISTS public.mad_stock_events (
 event_id uuid PRIMARY KEY,menu_item_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
 received_payload jsonb NOT NULL,payload jsonb,
 delivery_state text NOT NULL CHECK(delivery_state IN ('pending','published','superseded')),
 received_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,
 CHECK(payload IS NOT NULL OR delivery_state='superseded')
);
CREATE INDEX IF NOT EXISTS mad_stock_events_pending_idx ON public.mad_stock_events(received_at,event_id) WHERE delivery_state='pending';
REVOKE ALL ON public.mad_stock_alerts,public.mad_stock_events FROM PUBLIC;
COMMIT;
-- Replace mad_runtime with your restricted MAD runtime role after review:
-- GRANT SELECT(menu_item_id,name,stock_status,updated_at) ON public.kms_menu_items TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON public.mad_stock_alerts,public.mad_stock_events TO mad_runtime;
-- No KMS source-table INSERT/UPDATE/DELETE grants are required.
