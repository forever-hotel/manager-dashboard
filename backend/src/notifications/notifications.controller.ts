import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import {
  NotificationIdentityDto,
  EmptyNotificationQueryDto,
  NotificationPageDto,
  ReadNotificationDto
} from './notifications.dto';

@Controller('mad/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get() list(@Req() req: AuthenticatedRequest, @Query() query: NotificationPageDto) {
    return this.notifications.snapshot(req.user.sub, query);
  }

  @Patch(':type/:id/read') read(
    @Req() req: AuthenticatedRequest,
    @Param() identity: NotificationIdentityDto,
    @Body() input: ReadNotificationDto,
    @Query() query: EmptyNotificationQueryDto
  ) {
    void query;
    return this.notifications.markRead(req.user.sub, identity, input.revision);
  }
}
