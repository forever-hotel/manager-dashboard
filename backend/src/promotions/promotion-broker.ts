import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';

export interface PromotionMessage {
  eventId: string;
  type: 'promotion.upsert' | 'promotion.deleted';
  promotionId: string;
  version: number;
  occurredAt: string;
  promotion: Record<string, unknown>;
}

@Injectable()
export class PromotionBroker {
  constructor(private readonly config: ConfigService) {}

  async publish(message: PromotionMessage): Promise<void> {
    const body = Buffer.from(JSON.stringify(message));
    if (body.length > 8192) throw new Error('PROMOTION_EVENT_TOO_LARGE');
    const connection = await connect(
      this.config.getOrThrow<string>('RABBITMQ_URL'),
      { timeout: 5000 },
    );
    // Never log broker error objects: they may contain connection credentials.
    connection.on('error', () => undefined);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const channel = await connection.createConfirmChannel();
          channel.on('error', () => undefined);
          await channel.assertExchange('hotel.events', 'topic', {
            durable: true,
          });
          let returned = false;
          channel.on('return', () => {
            returned = true;
          });
          await new Promise<void>((resolve, reject) => {
            channel.publish(
              'hotel.events',
              message.type,
              body,
              {
                persistent: true,
                mandatory: true,
                contentType: 'application/json',
                messageId: message.eventId,
                type: message.type,
              },
              (error: unknown) => {
                if (error || returned)
                  reject(new Error('PROMOTION_NOT_ROUTED'));
                else resolve();
              },
            );
          });
        })(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('PROMOTION_CONFIRM_TIMEOUT')),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      await connection.close().catch(() => undefined);
    }
  }
}
