import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthProvider } from './auth-provider';
import { TokenService } from './token.service';

export interface Session {
  sub: string;
  username: string;
  role: string;
  expiresAt: number;
  passwordChangeRequired: boolean;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ServiceUnavailableException();
  return value as Record<string, unknown>;
}
@Injectable()
export class AuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly provider: AuthProvider,
    private readonly database: DataSource,
  ) {}
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  async session(token: string, allowPasswordChange = false): Promise<Session> {
    const claims = this.tokens.verify(token);
    const revoked = await this.database.query<{ token_hash: string }[]>(
      'SELECT token_hash FROM mad_revoked_sessions WHERE token_hash = $1',
      [this.digest(token)],
    );
    if (revoked.length) throw new UnauthorizedException();
    const state = record(
      await this.provider.request('/auth/session', 'GET', token),
    );
    if (state.active !== true || state.sub !== claims.sub)
      throw new UnauthorizedException();
    if (claims.role !== 'MANAGER' || state.role !== 'MANAGER')
      throw new ForbiddenException();
    if (
      typeof state.passwordChangeRequired !== 'boolean' ||
      typeof state.username !== 'string'
    )
      throw new ServiceUnavailableException();
    if (state.passwordChangeRequired && !allowPasswordChange)
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change your password before opening the dashboard.',
      });
    return {
      sub: claims.sub,
      username: state.username,
      role: claims.role,
      expiresAt: claims.exp,
      passwordChangeRequired: state.passwordChangeRequired,
    };
  }
  async login(body: { username: string; password: string }) {
    return this.accept(
      await this.provider.request('/auth/login', 'POST', undefined, body),
    );
  }
  private async accept(value: unknown) {
    const result = record(value);
    if (typeof result.accessToken !== 'string')
      throw new ServiceUnavailableException();
    const session = await this.session(result.accessToken, true);
    return { accessToken: result.accessToken, ...session };
  }
  async changePassword(
    token: string,
    body: { currentPassword: string; newPassword: string },
  ) {
    const previous = await this.session(token, true);
    const result = await this.accept(
      await this.provider.request('/auth/change-password', 'POST', token, body),
    );
    if (
      result.passwordChangeRequired ||
      result.accessToken === token ||
      result.sub !== previous.sub
    )
      throw new ServiceUnavailableException();
    await this.revoke(token);
    return result;
  }
  private async revoke(token: string) {
    const claims = this.tokens.verify(token);
    await this.database.query(
      'INSERT INTO mad_revoked_sessions(token_hash, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING',
      [this.digest(token), claims.exp],
    );
  }
  async logout(token: string) {
    // Local revocation happens first, so a provider outage never leaves this MAD session usable.
    await this.revoke(token);
    await this.provider.request('/auth/logout', 'POST', token);
    return { status: 'signed_out' };
  }
}
