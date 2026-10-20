-- DDP-035 read-only inspection. Run manually as the APPLICATION role, not
-- the Neon owner. No schema or data changes. Do not publish role names externally.
SELECT current_user AS application_role, rolsuper, rolcreatedb, rolcreaterole,
       rolbypassrls
FROM pg_roles WHERE rolname = current_user;

SELECT has_database_privilege(current_database(), 'CREATE') AS can_create_schema,
       has_schema_privilege('public', 'CREATE') AS can_create_public_objects;

-- Effective table rights include inherited roles and PUBLIC grants.
SELECT c.relname AS table_name,
       pg_get_userbyid(c.relowner) = current_user AS owns_table,
       has_table_privilege(c.oid, 'SELECT') AS can_select,
       has_table_privilege(c.oid, 'INSERT') AS can_insert,
       has_table_privilege(c.oid, 'UPDATE') AS can_update,
       has_table_privilege(c.oid, 'DELETE') AS can_delete,
       has_table_privilege(c.oid, 'TRUNCATE') AS can_truncate
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY c.relname;

-- Column grants matter for authorized complaint status/auth/profile updates;
-- table-level UPDATE=false alone does not prove all columns are read-only.
SELECT table_name, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND CASE WHEN grantee = 'PUBLIC' THEN true
           ELSE pg_has_role(current_user, grantee, 'USAGE') END
ORDER BY table_name, column_name, privilege_type;
