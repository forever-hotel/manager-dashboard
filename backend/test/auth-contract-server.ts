import { createServer, IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';

export async function startAuthContractServer(secret: string) {
  const jwt = new JwtService({ secret });
  const sessions = new Map<
    string,
    {
      active: boolean;
      sub: string;
      username: string;
      role: string;
      passwordChangeRequired: boolean;
    }
  >();
  let outage = false;
  async function body(
    request: IncomingMessage,
  ): Promise<Record<string, unknown>> {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  }
  function issue(
    username: string,
    pending = false,
    sub: string = randomUUID(),
  ) {
    const role = username === 'worker' ? 'WORKER' : 'MANAGER';
    const token = jwt.sign(
      { sub, role, iss: 'central-auth', jti: randomUUID() },
      { expiresIn: '8h' },
    );
    sessions.set(token, {
      active: true,
      sub,
      username,
      role,
      passwordChangeRequired: pending,
    });
    return token;
  }
  const server = createServer((request, response) => {
    void (async () => {
      const send = (status: number, value: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (outage) return send(503, {});
      const token = request.headers.authorization?.slice(7) ?? '';
      const state = sessions.get(token);
      if (request.url === '/auth/login' && request.method === 'POST') {
        const input = await body(request);
        if (
          !['manager', 'first-login', 'worker'].includes(
            String(input.username),
          ) ||
          input.password !== 'contract-password'
        )
          return send(401, {});
        return send(200, {
          accessToken: issue(
            String(input.username),
            input.username === 'first-login',
          ),
        });
      }
      if (!state?.active) return send(401, {});
      if (request.url === '/auth/session') return send(200, state);
      if (request.url === '/auth/logout') {
        state.active = false;
        return send(200, {});
      }
      if (request.url === '/auth/change-password') {
        const input = await body(request);
        if (
          input.currentPassword !== 'contract-password' ||
          input.newPassword === input.currentPassword ||
          typeof input.newPassword !== 'string' ||
          input.newPassword.length < 8
        )
          return send(400, {});
        state.active = false;
        return send(200, {
          accessToken: issue(state.username, false, state.sub),
        });
      }
      send(404, {});
    })().catch(() => {
      response.writeHead(500);
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
    sessions,
    issue,
    setOutage: (value: boolean) => {
      outage = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
