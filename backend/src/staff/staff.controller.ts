import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateStaffDto } from './create-staff.dto';
import { StaffService } from './staff.service';

@Controller('mad/staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}
  @Post()
  create(@Body() profile: CreateStaffDto) {
    return this.staff.create(profile);
  }
}
