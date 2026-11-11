import type { INestApplication, Type } from '@nestjs/common';
import type { App } from 'supertest/types';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthService } from '../src/auth/auth.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { channels } from '../src/realtime/relay-contracts';

interface SocketHub {
  ticket(subsystem: string, token: string, key: string): Promise<{ ticket: string; expiresIn: number }>;
  deliver(subsystem: string, name: string, data: unknown): void;
}

// Load the real standalone service for integration tests; production MAD has no socket server.
export async function sharedSocketFixture(owner: INestApplication) {
  const directory = resolve(process.env.SHARED_WEBSOCKET_PATH ?? '../../websocket');
  if (!existsSync(resolve(directory, 'dist/shared-websocket.module.js'))) {
    throw new Error('Build websocket-service first; set SHARED_WEBSOCKET_PATH to its checkout.');
  }
  const requireWebsocket = createRequire(resolve(directory, 'package.json'));
  const { Test } = requireWebsocket('@nestjs/testing') as { Test: typeof import('@nestjs/testing').Test };
  const { SharedWebsocketModule } = requireWebsocket('./dist/shared-websocket.module.js') as {
    SharedWebsocketModule: Type<unknown>;
  };
  const { SharedAuthService } = requireWebsocket('./dist/shared-auth.service.js') as {
    SharedAuthService: Type<unknown>;
  };
  const { SharedBroker } = requireWebsocket('./dist/shared-broker.service.js') as { SharedBroker: Type<unknown> };
  const { SharedGateway } = requireWebsocket('./dist/shared.gateway.js') as { SharedGateway: Type<SocketHub> };
  const relayKey = 'shared-socket-integration-only-key-32';
  const module = await Test.createTestingModule({ imports: [SharedWebsocketModule] })
    .overrideProvider(SharedBroker)
    .useValue({ ready: true })
    .overrideProvider(SharedAuthService)
    .useValue({
      systems: { mad: { origins: ['http://localhost:3000'], relayKey } },
      session: async (token: string) => ({ ...(await owner.get(AuthService).session(token)), channels: [...channels] })
    })
    .compile();
  const shared = module.createNestApplication<INestApplication<App>>();

  await shared.listen(0, '127.0.0.1');
  const hub = shared.get(SharedGateway);

  jest.spyOn(owner.get(RealtimeGateway), 'ticket').mockImplementation(token => hub.ticket('mad', token, relayKey));
  jest.spyOn(owner.get(RealtimeGateway), 'send').mockImplementation((name, data) => {
    hub.deliver('mad', name, name.endsWith('transport.status') ? data : { changed: true });
    return Promise.resolve();
  });
  return shared;
}
