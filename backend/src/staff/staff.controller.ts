import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { CreateStaffDto } from './create-staff.dto';
import { StaffService } from './staff.service';

@Controller('mad/staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.resetPassword(id, request.user.sub);
  }

  @Post()
  create(@Body() profile: CreateStaffDto) {
    return this.staff.create(profile);
  }
}
