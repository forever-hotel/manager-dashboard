-- MANUAL, READ ONLY: run in isolated reference and restored databases only.
-- Compare count + SHA256 of sorted row SHA256 values for every MAD-owned table.
-- Does not inspect/output raw rows or restore/mutate anything.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT format($query$
 SELECT %L AS table_name,count(*) AS row_count,
 encode(sha256(convert_to(coalesce(string_agg(row_digest,'' ORDER BY row_digest),''),'UTF8')),'hex') AS digest
 FROM (
   SELECT encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS row_digest
   FROM public.%I t
 ) AS fingerprints
$query$,tablename,tablename)
FROM pg_catalog.pg_tables
WHERE schemaname='public' AND left(tablename,4)='mad_'
ORDER BY tablename
\gexec
COMMIT;
