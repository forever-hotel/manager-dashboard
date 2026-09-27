import { DataSource } from 'typeorm';
import { migrate } from './migrate';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
  const database = new DataSource({
    type: 'postgres',
    url,
    logging: false,
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 30000 },
  });
  await database.initialize();
  try {
    await migrate(database, process.env.MAD_DB_ROLE ?? 'mad_app');
  } finally {
    await database.destroy();
  }
}
void main().catch(() => {
  console.error(
    'Migration failed. Check MIGRATION_DATABASE_URL, MAD_DB_ROLE, database privileges and existing schema constraints. No credentials are logged.',
  );
  process.exitCode = 1;
});
