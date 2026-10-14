import {
  Body,
  Get,
  Patch,
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
import { StaffProfilesService } from './staff-profiles.service';
import { UpdateStaffDto } from './update-staff.dto';
import { StaffService } from './staff.service';

@Controller('mad/staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly profiles: StaffProfilesService,
  ) {}
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.profiles.get(id);
  }
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() patch: UpdateStaffDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.profiles.update(id, request.user.sub, patch);
  }
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
