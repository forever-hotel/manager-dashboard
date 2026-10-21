import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { TaskLimitService } from './task-limit.service';
import { TaskLimitQueryDto, UpdateTaskLimitDto } from './task-limit.dto';
@Controller('mad/settings/task-limit')
@UseGuards(JwtAuthGuard)
export class TaskLimitController {
  constructor(private readonly policy: TaskLimitService) {}
  @Get() get(@Query() query: TaskLimitQueryDto) {
    void query;
    return this.policy.get();
  }
  @Patch() update(
    @Body() input: UpdateTaskLimitDto,
    @Req() req: AuthenticatedRequest,
    @Query() query: TaskLimitQueryDto,
  ) {
    void query;
    return this.policy.update(input, req.user.sub);
  }
}
