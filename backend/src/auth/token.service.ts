import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';

export interface StaffClaims {
  sub: string;
  iss: string;
  role: string;
  iat: number;
  exp: number;
}
@Injectable()
export class TokenService {
  constructor(
    @Inject(JwtService) private readonly jwt: Pick<JwtService, 'verify'>,
    @Inject(ConfigService)
    private readonly config: { getOrThrow<T>(name: string): T },
  ) {}
  verify(token: string): StaffClaims {
    try {
      const claims = this.jwt.verify<StaffClaims>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        algorithms: ['HS256'],
        issuer: this.config.getOrThrow<string>('JWT_ISSUER'),
      });
      const now = Math.floor(Date.now() / 1000);
      if (
        !isUUID(claims.sub) ||
        typeof claims.role !== 'string' ||
        !Number.isInteger(claims.iat) ||
        !Number.isInteger(claims.exp) ||
        claims.iat > now ||
        claims.exp <= now ||
        claims.exp - claims.iat !== 8 * 60 * 60
      )
        throw new Error();
      return claims;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
