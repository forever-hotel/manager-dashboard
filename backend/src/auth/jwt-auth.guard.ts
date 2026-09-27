import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthService, Session } from './auth.service';
import { bearer } from './auth.controller';

export interface AuthenticatedRequest extends Request {
  user: Session;
}
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.auth.session(
      bearer(request.headers.authorization),
    );
    return true;
  }
}
