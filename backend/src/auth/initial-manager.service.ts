import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { hashPassword } from './password';
import { randomBytes, randomUUID } from 'node:crypto';
import { CredentialCipher } from '../staff/credential-cipher';

@Injectable()
export class InitialManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitialManagerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource,
    private readonly cipher: CredentialCipher
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get<string>('INITIAL_MANAGER_EMAIL')?.trim().toLowerCase();
    const username = this.config.get<string>('INITIAL_MANAGER_USERNAME')?.trim().toLowerCase();

    if (!email && !username) return;
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Configure a valid INITIAL_MANAGER_EMAIL; INITIAL_MANAGER_USERNAME defaults to manager.');
    }
    try {
      await this.database.transaction(async manager => {
        // Serialize bootstrap instances without creating schema objects.
        await manager.query('SELECT pg_advisory_xact_lock(1790812800)');
        const existing = await manager.query<{ role: string; roles?: string[] }[]>(
          'SELECT role,roles FROM public.staff_users WHERE lower(email)=$1 FOR UPDATE',
          [email]
        );

        if (existing.length) {
          if (
            existing.length !== 1 ||
            !(existing[0].roles ?? [existing[0].role]).some(role => ['MANAGER', 'ROOT'].includes(role))
          )
            throw new Error('Conflicting staff identity');
          // The configured bootstrap administrator is ROOT, including an account
          // created before multi-role support. Promote once without resetting credentials.
          if (!(existing[0].roles ?? [existing[0].role]).includes('ROOT')) {
            const [promoted, affected] = await manager.query<[{ worker_id: string }[], number]>(
              `UPDATE public.staff_users SET roles=ARRAY['ROOT']::text[],
               session_version=session_version+1,updated_at=now()
               WHERE lower(email)=$1 AND NOT ('ROOT'=ANY(roles)) RETURNING worker_id`,
              [email]
            );
            if (affected !== 1 || promoted.length !== 1) throw new Error('Conflicting staff identity');
          }
          // Preserve passwords, first-login state, activation and usernames.
          return;
        }
        // Initial credentials matter only when creating the account. On later
        // starts the stored account (including its changed password) wins.
        const initialUsername = username || 'manager';
        if (initialUsername.length > 100 || this.config.get<string>('STAFF_EMAIL_ENABLED') !== 'true')
          throw new Error('Initial account requires enabled staff email');
        const password = randomBytes(24).toString('base64url');
        const deliveryId = randomUUID();
        const encrypted = this.cipher.encrypt(deliveryId, { email, username: initialUsername, password, role: 'ROOT' });
        const passwordHash = await hashPassword(password);
        const inserted = await manager.query<{ worker_id: string; session_version: number }[]>(
          `INSERT INTO public.staff_users
            (full_name,vocation,email,username,password_hash,role,roles,is_active,password_change_required)
           VALUES ('Root Administrator','Administrator',$1,$2,$3,'MANAGER',ARRAY['ROOT']::text[],true,true)
           ON CONFLICT DO NOTHING RETURNING worker_id,session_version`,
          [email, initialUsername, passwordHash]
        );

        if (!inserted.length) throw new Error('Conflicting staff identity');
        await manager.query(
          `INSERT INTO public.mad_staff_deliveries(delivery_id,worker_id,encrypted_credentials,credential_version)
           VALUES ($1,$2,$3,$4)`,
          [deliveryId, inserted[0].worker_id, encrypted, inserted[0].session_version]
        );
      });
      this.logger.log('Initial manager checked; existing account credentials are preserved.');
    } catch {
      // Do not let Nest log raw driver errors, parameters or password hashes.
      throw new Error(
        'Initial manager provisioning failed. Check staff schema, SELECT/INSERT/UPDATE privileges, staff email configuration, delivery schema and email/username conflicts.'
      );
    }
  }
}
