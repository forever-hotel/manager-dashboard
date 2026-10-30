import { StaffDirectoryService } from './staff-directory.service';
import { StaffDeleteDto, StaffDetailQueryDto, StaffDirectoryDto } from './staff-directory.dto';
import {
  Body,
  Delete,
  Query,
  Get,
  Patch,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards
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
    private readonly directory: StaffDirectoryService
  ) {}

  @Get()
  list(@Query() query: StaffDirectoryDto) {
    return this.directory.list(query);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: StaffDetailQueryDto) {
    void query;
    return this.directory.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() patch: UpdateStaffDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.profiles.update(id, request.user.sub, patch);
  }

  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: StaffDeleteDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.profiles.remove(id, request.user.sub, body.version);
  }

  @Post()
  create(@Body() profile: CreateStaffDto) {
    return this.staff.create(profile);
  }
}
