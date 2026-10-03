import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { hashPassword, validPassword } from './password';

@Injectable()
export class InitialManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitialManagerService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config
      .get<string>('INITIAL_MANAGER_EMAIL')
      ?.trim()
      .toLowerCase();
    const username = this.config
      .get<string>('INITIAL_MANAGER_USERNAME')
      ?.trim()
      .toLowerCase();
    const password = this.config.get<string>('INITIAL_MANAGER_PASSWORD');
    if (!email && !username && !password) return;
    if (
      !email ||
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new Error(
        'Configure INITIAL_MANAGER_EMAIL, INITIAL_MANAGER_USERNAME and INITIAL_MANAGER_PASSWORD (12-1024 characters) together.',
      );
    }
    try {
      await this.database.transaction(async (manager) => {
        // Serialize bootstrap instances without creating schema objects.
        await manager.query('SELECT pg_advisory_xact_lock(1790812800)');
        const existing = await manager.query<{ role: string }[]>(
          'SELECT role FROM public.staff_users WHERE lower(email)=$1',
          [email],
        );
        if (existing.length) {
          if (existing.length !== 1 || existing[0].role !== 'MANAGER')
            throw new Error('Conflicting staff identity');
          // Never reset passwords, first-login state, activation or usernames,
          // including accounts that have not changed their initial password yet.
          return;
        }
        // Initial credentials matter only when creating the account. On later
        // starts the stored account (including its changed password) wins.
        if (
          !username ||
          username.length > 100 ||
          !password ||
          !validPassword(password)
        )
          throw new Error('Missing or invalid initial account credentials');
        const passwordHash = await hashPassword(password);
        const inserted = await manager.query<{ worker_id: string }[]>(
          `INSERT INTO public.staff_users
            (full_name,vocation,email,username,password_hash,role,is_active,password_change_required)
           VALUES ('Initial Manager','Manager',$1,$2,$3,'MANAGER',true,true)
           ON CONFLICT DO NOTHING RETURNING worker_id`,
          [email, username, passwordHash],
        );
        if (!inserted.length) throw new Error('Conflicting staff identity');
      });
      this.logger.log(
        'Initial manager checked; existing account credentials are preserved.',
      );
    } catch {
      // Do not let Nest log raw driver errors, parameters or password hashes.
      throw new Error(
        'Initial manager provisioning failed. Check staff schema, SELECT/INSERT privileges and email/username conflicts.',
      );
    }
  }
}
