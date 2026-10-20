import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { bearer } from '../auth/auth.controller';
import { RealtimeGateway } from './realtime.gateway';

@Controller('mad/realtime')
@UseGuards(JwtAuthGuard)
export class RealtimeController {
  constructor(private readonly gateway: RealtimeGateway) {}
  @Post('ticket') ticket(@Req() request: AuthenticatedRequest) {
    return this.gateway.ticket(bearer(request.headers.authorization));
  }
}
