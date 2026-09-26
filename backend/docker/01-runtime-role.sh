#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv runtime_password MAD_DB_PASSWORD
SELECT format('CREATE ROLE mad_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'runtime_password') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
