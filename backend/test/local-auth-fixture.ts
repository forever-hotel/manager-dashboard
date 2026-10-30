import { createServer } from 'node:http';
import { AuthService } from './fixtures/auth-provider';
import { TokenService } from './fixtures/token-service';
import { ConfigService } from '@nestjs/config';
// TEST ONLY: real local account rows; no external Auth server.
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { hashPassword } from '../src/auth/password';

export async function seedLocalAuth(database: DataSource, secret: string, role: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('Invalid fixture role');
  await database.query(`CREATE TABLE IF NOT EXISTS staff_users (worker_id uuid PRIMARY KEY, password_hash text);
    ALTER TABLE staff_users ALTER COLUMN worker_id SET DEFAULT gen_random_uuid();
    ALTER TABLE staff_users
      ADD COLUMN IF NOT EXISTS full_name varchar(255) NOT NULL DEFAULT 'Fixture Staff',
      ADD COLUMN IF NOT EXISTS email varchar(320) UNIQUE,
      ADD COLUMN IF NOT EXISTS vocation varchar(100) NOT NULL DEFAULT 'Manager',
      ADD COLUMN IF NOT EXISTS username varchar(100) UNIQUE,
      ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'MANAGER',
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS password_change_required boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until timestamptz,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    GRANT SELECT ON staff_users TO "${role}";
    GRANT UPDATE(password_hash,password_change_required,session_version,failed_attempts,locked_until,updated_at) ON staff_users TO "${role}";`);
  const jwt = new JwtService({ secret });
  const ids = new Map<string, string>();
  const passwordHash = await hashPassword('contract-password');

  for (const username of ['manager', 'first-login', 'worker']) {
    const id = randomUUID();

    ids.set(username, id);
    await database.query(
      'INSERT INTO staff_users(worker_id,username,password_hash,password_change_required,role) VALUES ($1,$2,$3,$4,$5)',
      [id, username, passwordHash, username === 'first-login', username === 'worker' ? 'WORKER' : 'MANAGER']
    );
  }
  const close = await startAuthFixture(database, secret);

  return {
    close,
    ids,
    issue(username: string) {
      const sub = ids.get(username);

      if (!sub) throw new Error('Unknown test account');
      return jwt.sign(
        {
          sub,
          role: username === 'worker' ? 'WORKER' : 'MANAGER',
          ver: 0,
          jti: randomUUID()
        },
        { issuer: 'mad', audience: 'mad', expiresIn: '8h' }
      );
    }
  };
}

export async function startAuthFixture(database: DataSource, secret: string) {
  const service = new AuthService(
    new TokenService(new JwtService({ secret }), new ConfigService({ JWT_SECRET: secret, JWT_ISSUER: 'mad' })),
    database
  );
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const parts: Buffer[] = [];

        for await (const part of request) {
          const chunk: unknown = part;

          if (Buffer.isBuffer(chunk)) parts.push(chunk);
        }
        const body = (parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {}) as {
          username: string;
          password: string;
          currentPassword: string;
          newPassword: string;
        };
        const token = request.headers.authorization?.slice(7) ?? '';
        const action = request.url?.split('/').at(-1);
        const result =
          action === 'session'
            ? await service.session(token, true)
            : action === 'login'
              ? await service.login(body)
              : action === 'change-password'
                ? await service.changePassword(token, body)
                : action === 'logout'
                  ? await service.logout(token)
                  : null;

        response.writeHead(result ? 200 : 404, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
      } catch (error) {
        const failure = error as { getStatus?: () => number; getResponse?: () => unknown };

        response.writeHead(failure.getStatus?.() ?? 503, { 'content-type': 'application/json' });
        response.end(JSON.stringify(failure.getResponse?.() ?? {}));
      }
    })();
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('Auth fixture unavailable');
  const previous = process.env.AUTH_SERVICE_URL;

  process.env.AUTH_SERVICE_URL = 'http://127.0.0.1:' + address.port;
  return async () => {
    if (previous === undefined) delete process.env.AUTH_SERVICE_URL;
    else process.env.AUTH_SERVICE_URL = previous;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  };
}
