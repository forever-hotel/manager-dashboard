import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';

export interface Session {
  sub: string;
  username: string;
  role: string;
  expiresAt: number;
  passwordChangeRequired: boolean;
}
// Authentication and JWT handling belong to the gateway. This adapter also
// protects direct backend calls, so bypassing the gateway cannot bypass access checks.
@Injectable()
export class AuthService {
  constructor(private readonly config: ConfigService) {}

  private async call(path: string, method: string, token?: string, body?: unknown) {
    try {
      const origin = this.config.getOrThrow<string>('AUTH_SERVICE_URL');
      const response = await fetch(origin + '/mad/auth/' + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const data: unknown = await response.json();

      if (response.status === 401) throw new UnauthorizedException();
      if (response.status === 403) throw new ForbiddenException(data && typeof data === 'object' ? data : undefined);
      if (response.status === 400) throw new BadRequestException();
      if (!response.ok) throw new ServiceUnavailableException();
      return data;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      )
        throw error;
      throw new ServiceUnavailableException();
    }
  }

  async session(token: string, allowPasswordChange = false): Promise<Session> {
    const body = (await this.call('session', 'GET', token)) as Partial<Session> | null;

    if (
      !body ||
      typeof body.sub !== 'string' ||
      !isUUID(body.sub) ||
      typeof body.username !== 'string' ||
      typeof body.role !== 'string' ||
      !Number.isSafeInteger(body.expiresAt) ||
      body.expiresAt! * 1000 <= Date.now() ||
      typeof body.passwordChangeRequired !== 'boolean'
    )
      throw new ServiceUnavailableException();
    if (body.role !== 'MANAGER') throw new ForbiddenException();
    if (body.passwordChangeRequired && !allowPasswordChange)
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change your password before opening the dashboard.'
      });
    return body as Session;
  }

  login(body: { username: string; password: string }) {
    return this.call('login', 'POST', undefined, body);
  }

  changePassword(token: string, body: { currentPassword: string; newPassword: string }) {
    return this.call('change-password', 'POST', token, body);
  }

  logout(token: string) {
    return this.call('logout', 'POST', token, {});
  }
}
