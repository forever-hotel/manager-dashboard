// Shared by the explicit account-provisioning CLI. Never runs schema changes.
export function databaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_HOST, DB_USERNAME, DB_PASSWORD, DB_NAME } = env;
  if (!DB_HOST || !DB_USERNAME || !DB_PASSWORD || !DB_NAME) return undefined;
  return `postgresql://${encodeURIComponent(DB_USERNAME)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${env.DB_PORT ?? '5432'}/${encodeURIComponent(DB_NAME)}`;
}
