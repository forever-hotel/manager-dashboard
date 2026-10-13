import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CredentialCipher } from './credential-cipher';
import { SendGridService } from './sendgrid.service';

interface Delivery {
  delivery_id: string;
  worker_id: string;
  encrypted_credentials: string;
  attempts: number;
  credential_version: number;
}

@Injectable()
export class StaffDeliveryWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(StaffDeliveryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly cipher: CredentialCipher,
    private readonly mail: SendGridService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('STAFF_EMAIL_ENABLED') !== 'true') return;
    const tick = () => {
      if (this.running) return;
      this.running = this.processOnce()
        .catch(() => {
          this.logger.error('Staff delivery processing unavailable');
        })
        .finally(() => {
          this.running = undefined;
        });
    };
    this.timer = setInterval(tick, 15000);
    this.timer.unref();
    tick();
  }
  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }

  async processOnce() {
    if (this.config.get('STAFF_EMAIL_ENABLED') !== 'true') return;
    const lease = randomUUID();
    const rows: Delivery[] = await this.database.query(
      `WITH candidate AS (
      SELECT delivery_id FROM public.mad_staff_deliveries
      WHERE status IN ('pending','failed') AND next_attempt_at <= now()
        AND (lease_until IS NULL OR lease_until < now())
      ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1
    ), claimed AS (
      UPDATE public.mad_staff_deliveries d SET lease_token=$1, lease_until=now()+interval '60 seconds',
        attempts=attempts+1, updated_at=now() FROM candidate c WHERE d.delivery_id=c.delivery_id RETURNING d.*
    ) SELECT * FROM claimed`,
      [lease],
    );
    const delivery = rows[0];
    if (!delivery) return;
    try {
      const accounts: {
        is_active: boolean;
        password_change_required: boolean;
        session_version: number;
      }[] = await this.database.query(
        'SELECT is_active,password_change_required,session_version FROM public.staff_users WHERE worker_id=$1',
        [delivery.worker_id],
      );
      const account = accounts[0];
      if (
        !account?.is_active ||
        !account.password_change_required ||
        account.session_version !== delivery.credential_version
      ) {
        await this.finish(delivery.delivery_id, lease, 'cancelled');
        return;
      }
      await this.mail.send(
        this.cipher.decrypt(
          delivery.delivery_id,
          delivery.encrypted_credentials,
        ),
      );
      await this.finish(delivery.delivery_id, lease, 'sent');
    } catch {
      const delay = Math.min(
        3600,
        30 * 2 ** Math.min(delivery.attempts - 1, 7),
      );
      await this.database.query(
        `UPDATE public.mad_staff_deliveries SET status='failed',
        last_error_code='EMAIL_DELIVERY_FAILED', next_attempt_at=now()+($3 * interval '1 second'),
        lease_token=NULL,lease_until=NULL,updated_at=now() WHERE delivery_id=$1 AND lease_token=$2`,
        [delivery.delivery_id, lease, delay],
      );
    }
  }
  private async finish(
    id: string,
    lease: string,
    status: 'sent' | 'cancelled',
  ) {
    await this.database.query(
      `UPDATE public.mad_staff_deliveries SET status=$3,encrypted_credentials=NULL,
      last_error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=now(),
      sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END WHERE delivery_id=$1 AND lease_token=$2`,
      [id, lease, status],
    );
  }
}
