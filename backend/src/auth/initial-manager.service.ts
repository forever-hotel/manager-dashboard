import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { hashPassword, validPassword } from './password';

@Injectable()
export class InitialManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitialManagerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get<string>('INITIAL_MANAGER_EMAIL')?.trim().toLowerCase();
    const username = this.config.get<string>('INITIAL_MANAGER_USERNAME')?.trim().toLowerCase();
    const password = this.config.get<string>('INITIAL_MANAGER_PASSWORD');

    if (!email && !username && !password) return;
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(
        'Configure INITIAL_MANAGER_EMAIL, INITIAL_MANAGER_USERNAME and INITIAL_MANAGER_PASSWORD (at least 12 characters, at most 72 UTF-8 bytes) together.'
      );
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
        if (!username || username.length > 100 || !password || !validPassword(password))
          throw new Error('Missing or invalid initial account credentials');
        const passwordHash = await hashPassword(password);
        const inserted = await manager.query<{ worker_id: string }[]>(
          `INSERT INTO public.staff_users
            (full_name,vocation,email,username,password_hash,role,roles,is_active,password_change_required)
           VALUES ('Root Administrator','Administrator',$1,$2,$3,'MANAGER',ARRAY['ROOT']::text[],true,true)
           ON CONFLICT DO NOTHING RETURNING worker_id`,
          [email, username, passwordHash]
        );

        if (!inserted.length) throw new Error('Conflicting staff identity');
      });
      this.logger.log('Initial manager checked; existing account credentials are preserved.');
    } catch {
      // Do not let Nest log raw driver errors, parameters or password hashes.
      throw new Error(
        'Initial manager provisioning failed. Check staff schema, SELECT/INSERT/UPDATE privileges and email/username conflicts.'
      );
    }
  }
}
