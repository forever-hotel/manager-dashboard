import { DataSource } from 'typeorm';
import { hashPassword, validPassword } from './password';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  const username = process.env.MAD_MANAGER_USERNAME?.trim().toLowerCase();
  const password = process.env.MAD_MANAGER_PASSWORD;
  delete process.env.MAD_MANAGER_PASSWORD;
  if (
    !url ||
    !username ||
    username.length > 100 ||
    !password ||
    !validPassword(password)
  )
    throw new Error('Invalid provisioning configuration');
  const database = new DataSource({
    type: 'postgres',
    url,
    logging: false,
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 30000 },
  });
  const passwordHash = await hashPassword(password);
  await database.initialize();
  try {
    // INSERT only: never silently reset an existing manager account.
    await database.query(
      'INSERT INTO mad_manager_accounts(username,password_hash) VALUES ($1,$2)',
      [username, passwordHash],
    );
    console.log('Manager created. Password change is required on first login.');
  } finally {
    await database.destroy();
  }
}
void main().catch(() => {
  console.error('Manager provisioning failed. Check owner database access, migrations, a unique username and a 12–1024 character password. No credentials are logged.');
  process.exitCode = 1;
});
