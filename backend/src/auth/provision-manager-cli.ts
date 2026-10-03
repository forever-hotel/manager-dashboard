import { DataSource } from 'typeorm';
import { hashPassword, validPassword } from './password';
import { databaseUrl } from '../database/connection';

async function main() {
  const url = databaseUrl(process.env);
  const fullName = process.env.MAD_MANAGER_FULL_NAME?.trim();
  const email = process.env.MAD_MANAGER_EMAIL?.trim();
  const username = process.env.MAD_MANAGER_USERNAME?.trim().toLowerCase();
  const password = process.env.MAD_MANAGER_PASSWORD;
  delete process.env.MAD_MANAGER_PASSWORD;
  if (
    !url ||
    !fullName ||
    !email ||
    !username ||
    username.length > 100 ||
    !password ||
    !validPassword(password)
  )
    throw new Error('Invalid provisioning configuration');
  const database = new DataSource({
    type: 'postgres',
    url,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
    logging: false,
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 30000 },
  });
  const passwordHash = await hashPassword(password);
  await database.initialize();
  try {
    // INSERT only: never silently reset an existing manager account.
    await database.query(
      "INSERT INTO staff_users(username,password_hash,full_name,email,vocation,role) VALUES ($1,$2,$3,$4,'Manager','MANAGER')",
      [username, passwordHash, fullName, email],
    );
    console.log('Manager created. Password change is required on first login.');
  } finally {
    await database.destroy();
  }
}
void main().catch(() => {
  console.error('Manager provisioning failed. Check database access, the manual auth supplement, full name, unique email/username and a 12–1024 character password. No credentials are logged.');
  process.exitCode = 1;
});
