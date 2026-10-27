import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RealtimeGateway } from './realtime.gateway';
// Read-only reconciliation works even before upstream teams publish booking/payment events.
// Fingerprints contain no guest data. Every read is a single consistent DB snapshot.
export const ANALYTICS_FINGERPRINT_SQL = `SELECT
  (SELECT md5(coalesce(string_agg(row_to_json(s)::text,',' ORDER BY s.booking_id,s.check_in_date,s.status,s.updated_at),'')) FROM
    (SELECT booking_id,check_in_date,status,updated_at FROM public.mad_booking_analytics) s) AS bookings,
  (SELECT md5(coalesce(string_agg(row_to_json(s)::text,',' ORDER BY s.payment_id),'')) FROM
    (SELECT payment_id,amount,payment_status,paid_at,updated_at FROM public.payments) s) AS payments,
  (SELECT md5(coalesce(string_agg(row_to_json(s)::text,',' ORDER BY s.order_id),'')) FROM
    (SELECT order_id,status,placed_at,delivered_at,total_amount,updated_at FROM public.kms_food_orders) s) AS food,
  (SELECT md5(coalesce(string_agg(row_to_json(s)::text,',' ORDER BY s.order_item_id),'')) FROM
    (SELECT order_item_id,order_id,menu_item_id,name,quantity,updated_at FROM public.kms_food_order_items) s) AS items`;
@Injectable()
export class AnalyticsChangesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsChangesWorker.name);
  private failed = false;
  private previous?: { bookings: string; payments: string; food: string; items: string };
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly database: DataSource,
    private readonly gateway: RealtimeGateway,
    private readonly config: ConfigService
  ) {}
  async tick() {
    try {
      const [current] =
        await this.database.query<{ bookings: string; payments: string; food: string; items: string }[]>(
          ANALYTICS_FINGERPRINT_SQL
        );
      if (!current) throw new Error();
      if (!this.previous || current.bookings !== this.previous.bookings || current.payments !== this.previous.payments)
        await this.gateway.send('analytics.changed', {});
      if (!this.previous || current.food !== this.previous.food || current.items !== this.previous.items)
        await this.gateway.send('food.analytics.changed', {});
      this.previous = current;
      this.gateway.analyticsHealthy = true;
      this.failed = false;
    } catch {
      if (!this.failed)
        this.logger.warn('Analytics change detection unavailable; clients will reconcile through their APIs.');
      this.failed = true;
      this.gateway.analyticsHealthy = false;
    }
  }
  onModuleInit() {
    if (this.config.get<string>('MAD_REALTIME_ENABLED') !== 'true') return;
    const poll = () => {
      this.running = this.tick().finally(() => {
        if (!this.stopped) {
          this.timer = setTimeout(poll, 2000);
          this.timer.unref();
        }
      });
    };
    poll();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
