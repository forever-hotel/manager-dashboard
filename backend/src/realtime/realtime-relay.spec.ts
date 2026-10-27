import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { RealtimeGateway } from './realtime.gateway';
jest.mock('amqplib', () => ({ connect: jest.fn() }));
describe('MAD relay to the shared service', () => {
  it('confirms persistent invalidations without publishing source payloads', async () => {
    const publish = jest.fn(
      (_exchange: string, _key: string, _body: Buffer, _options: unknown, done: (error: null) => void) => {
        done(null);
        return true;
      }
    );
    const channel = { on: jest.fn(), assertExchange: jest.fn(), assertQueue: jest.fn(), bindQueue: jest.fn(), publish };
    const close = jest.fn().mockResolvedValue(undefined);
    jest.mocked(connect).mockResolvedValue({
      on: jest.fn(),
      createConfirmChannel: () => Promise.resolve(channel),
      close
    } as unknown as Awaited<ReturnType<typeof connect>>);
    const relay = new RealtimeGateway(new ConfigService({ RABBITMQ_URL: 'amqp://localhost/test' }));
    await relay.send('room.status.changed', { room: { guest: 'PRIVATE' } });
    expect(publish).toHaveBeenCalledWith(
      'hotel.realtime',
      'mad.room.status.changed',
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
      expect.any(Function)
    );
    expect(publish.mock.calls[0][2].toString()).toBe('{"subsystem":"mad","name":"room.status.changed"}');
    await relay.onModuleDestroy();
    expect(close).toHaveBeenCalled();
  });
});
