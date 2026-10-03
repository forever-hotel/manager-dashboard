import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { TokenService } from './token.service';
import type { StaffClaims } from './token.service';
import { hashPassword, validPassword, verifyPassword } from './password';

export interface Session {
  sub: string;
  username: string;
  role: string;
  expiresAt: number;
  passwordChangeRequired: boolean;
}
interface Account {
  worker_id: string;
  username: string;
  password_hash: string;
  is_active: boolean;
  role: string;
  password_change_required: boolean;
  session_version: number;
  failed_attempts: number;
  locked_until: Date | null;
}
@Injectable()
export class AuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly database: DataSource,
  ) {}
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private async storage<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException();
    }
  }
  private describe(account: Account, claims: StaffClaims): Session {
    if (!account.is_active || account.session_version !== claims.ver)
      throw new UnauthorizedException();
    if (claims.role !== 'MANAGER' || account.role !== 'MANAGER')
      throw new ForbiddenException();
    return {
      sub: account.worker_id,
      username: account.username,
      role: 'MANAGER',
      expiresAt: claims.exp,
      passwordChangeRequired: account.password_change_required,
    };
  }
  async session(token: string, allowPasswordChange = false): Promise<Session> {
    const claims = this.tokens.verify(token);
    const rows = await this.storage(() =>
      this.database.query<Account[]>(
        'SELECT a.* FROM staff_users a WHERE worker_id = $1 AND NOT EXISTS (SELECT 1 FROM mad_revoked_sessions WHERE token_hash = $2)',
        [claims.sub, this.digest(token)],
      ),
    );
    if (!rows[0]) throw new UnauthorizedException();
    const session = this.describe(rows[0], claims);
    if (session.passwordChangeRequired && !allowPasswordChange)
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change your password before opening the dashboard.',
      });
    return session;
  }
  private locked(account: Account) {
    return (
      account.locked_until !== null &&
      new Date(account.locked_until).getTime() > Date.now()
    );
  }
  private async failure(manager: EntityManager, account: Account) {
    // The row is locked by the caller, so simultaneous guesses cannot lose increments.
    const attempts = account.locked_until ? 1 : account.failed_attempts + 1;
    await manager.query(
      "UPDATE staff_users SET failed_attempts=$2, locked_until=CASE WHEN $2 >= 5 THEN now()+interval '15 minutes' ELSE NULL END, updated_at=now() WHERE worker_id=$1",
      [account.worker_id, attempts],
    );
  }
  private issue(account: Account) {
    const accessToken = this.tokens.issue(
      account.worker_id,
      account.session_version,
    );
    return {
      accessToken,
      ...this.describe(account, this.tokens.verify(accessToken)),
    };
  }
  async login(body: { username: string; password: string }) {
    const result = await this.storage(() =>
      this.database.transaction(async (manager) => {
        const rows = await manager.query<Account[]>(
          "SELECT * FROM staff_users WHERE username=$1 AND role='MANAGER' FOR UPDATE",
          [body.username.trim().toLowerCase()],
        );
        const account = rows[0];
        const valid = await verifyPassword(
          body.password,
          account?.password_hash,
        );
        if (!account || !account.is_active || this.locked(account)) return null;
        if (!valid) {
          await this.failure(manager, account);
          return null; // Commit failed-attempt counters before returning 401.
        }
        await manager.query(
          'UPDATE staff_users SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE worker_id=$1',
          [account.worker_id],
        );
        return this.issue(account);
      }),
    );
    if (!result) throw new UnauthorizedException();
    return result;
  }
  async changePassword(
    token: string,
    body: { currentPassword: string; newPassword: string },
  ) {
    if (
      !validPassword(body.newPassword) ||
      body.currentPassword === body.newPassword
    )
      throw new BadRequestException(
        'Use a different password with 12 to 1024 characters.',
      );
    const claims = this.tokens.verify(token);
    const result = await this.storage(() =>
      this.database.transaction(async (manager) => {
        const rows = await manager.query<Account[]>(
          'SELECT * FROM staff_users WHERE worker_id=$1 FOR UPDATE',
          [claims.sub],
        );
        const account = rows[0];
        if (!account) throw new UnauthorizedException();
        this.describe(account, claims);
        const revoked = await manager.query<{ token_hash: string }[]>(
          'SELECT token_hash FROM mad_revoked_sessions WHERE token_hash=$1',
          [this.digest(token)],
        );
        if (revoked.length || this.locked(account))
          throw new UnauthorizedException();
        if (
          !(await verifyPassword(body.currentPassword, account.password_hash))
        ) {
          await this.failure(manager, account);
          return null;
        }
        const passwordHash = await hashPassword(body.newPassword);
        const updated = await manager.query<Account[]>(
          'WITH updated AS (UPDATE staff_users SET password_hash=$2, password_change_required=false, session_version=session_version+1, failed_attempts=0, locked_until=NULL, updated_at=now() WHERE worker_id=$1 RETURNING *) SELECT * FROM updated',
          [account.worker_id, passwordHash],
        );
        // The new version invalidates every older session, including concurrent logins.
        return this.issue(updated[0]);
      }),
    );
    if (!result) throw new UnauthorizedException();
    return result;
  }
  async logout(token: string) {
    const claims = this.tokens.verify(token);
    if (claims.role !== 'MANAGER') throw new ForbiddenException();
    await this.storage(() =>
      this.database.query(
        'INSERT INTO mad_revoked_sessions(token_hash, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING',
        [this.digest(token), claims.exp],
      ),
    );
    return { status: 'signed_out' };
  }
}
