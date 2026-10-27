import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { Test } from '@nestjs/testing';
import { SharedWebsocketModule } from '../src/shared-websocket/main';
import { SharedAuthService } from '../src/shared-websocket/shared-auth.service';
import { SharedBroker } from '../src/shared-websocket/shared-broker.service';
import { SharedGateway } from '../src/shared-websocket/shared.gateway';
import { channels } from '../src/shared-websocket/contracts';
import { AuthService } from '../src/auth/auth.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
// Real separate socket server and owner-auth verification. Broker delivery is
// independently covered; these tests isolate socket/API semantics on PostgreSQL.
export async function sharedSocketFixture(owner: INestApplication) {
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
