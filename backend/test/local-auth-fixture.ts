// TEST ONLY: real local account rows; no external Auth server.
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { hashPassword } from '../src/auth/password';

export async function seedLocalAuth(database: DataSource, secret: string) {
  const jwt = new JwtService({ secret });
  const ids = new Map<string, string>();
  const passwordHash = await hashPassword('contract-password');
  for (const username of ['manager', 'first-login', 'worker']) {
    const id = randomUUID();
    ids.set(username, id);
    await database.query(
      'INSERT INTO mad_manager_accounts(manager_id,username,password_hash,password_change_required) VALUES ($1,$2,$3,$4)',
      [id, username, passwordHash, username === 'first-login'],
    );
  }
  return {
    ids,
    issue(username: string) {
      const sub = ids.get(username);
      if (!sub) throw new Error('Unknown test account');
      return jwt.sign({
        sub, role: username === 'worker' ? 'WORKER' : 'MANAGER',
        ver: 0, jti: randomUUID(),
      }, { issuer: 'mad', audience: 'mad', expiresIn: '8h' });
    },
  };
}
