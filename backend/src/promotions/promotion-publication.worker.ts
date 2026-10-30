import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PromotionBroker, PromotionMessage } from './promotion-broker';

interface Publication {
  event_id: string;
  promo_id: string;
  promotion_version: number;
  event_type: PromotionMessage['type'];
  payload: Record<string, unknown>;
  created_at: Date;
  attempts: number;
}

@Injectable()
export class PromotionPublicationWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PromotionPublicationWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource,
    private readonly broker: PromotionBroker
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('MAD_PROMOTIONS_PUBLISH_ENABLED') !== 'true') return;
    const tick = () => {
      if (this.running) return;
      this.running = this.processOnce()
        .catch(() => {
          this.logger.warn('Promotion publication storage unavailable');
        })
        .finally(() => {
          this.running = undefined;
        });
    };

    this.timer = setInterval(tick, 250);
    this.timer.unref();
    tick();
  }

  async processOnce() {
    if (this.config.get('MAD_PROMOTIONS_PUBLISH_ENABLED') !== 'true') return;
    await this.database.transaction(async manager => {
      // Row lock is retained through broker confirmation. A process crash rolls
      // back the mark; the same event ID is sent again after restart.
      const [row] = await manager.query<Publication[]>(`
        SELECT o.* FROM public.mad_promotion_outbox o
        WHERE o.published_at IS NULL AND o.next_attempt_at <= now()
          AND NOT EXISTS (SELECT 1 FROM public.mad_promotion_outbox older
            WHERE older.promo_id=o.promo_id AND older.promotion_version<o.promotion_version
              AND older.published_at IS NULL)
        ORDER BY o.created_at,o.event_id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);

      if (!row) return;
      const message: PromotionMessage = {
        eventId: row.event_id,
        type: row.event_type,
        promotionId: row.promo_id,
        version: row.promotion_version,
        occurredAt: row.created_at.toISOString(),
        promotion: row.payload
      };

      try {
        if (
          row.payload.id !== row.promo_id ||
          row.payload.version !== row.promotion_version ||
          (row.event_type === 'promotion.deleted') !== (row.payload.deletedAt !== null)
        )
          throw new Error('Invalid publication');
        await this.broker.publish(message);
      } catch {
        const delay = Math.min(3600, 2 ** Math.min(row.attempts, 12));

        await manager.query(
          `UPDATE public.mad_promotion_outbox
          SET attempts=LEAST(attempts::bigint+1,2147483647)::integer,
            last_error='PROMOTION_PUBLICATION_FAILED',
            next_attempt_at=now()+($2 * interval '1 second') WHERE event_id=$1`,
          [row.event_id, delay]
        );
        return;
      }
      // A DB failure here MUST roll back, not be swallowed as a broker failure.
      await manager.query(
        `UPDATE public.mad_promotion_outbox SET published_at=now(),
        attempts=LEAST(attempts::bigint+1,2147483647)::integer,last_error=NULL
        WHERE event_id=$1`,
        [row.event_id]
      );
    });
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }
}
