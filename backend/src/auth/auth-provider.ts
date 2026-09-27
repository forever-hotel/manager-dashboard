import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthProvider {
  constructor(private readonly config: ConfigService) {}
  async request(
    path: string,
    method: string,
    token?: string,
    body?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(
        this.config.getOrThrow<string>('AUTH_SERVICE_URL').replace(/\/$/, '') +
          path,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
          cache: 'no-store',
        },
      );
    } catch {
      throw new ServiceUnavailableException();
    }
    if (response.status === 401) throw new UnauthorizedException();
    if (response.status === 403) throw new ForbiddenException();
    if (response.status === 400)
      throw new BadRequestException('Authentication request was rejected.');
    if (!response.ok) throw new ServiceUnavailableException();
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
