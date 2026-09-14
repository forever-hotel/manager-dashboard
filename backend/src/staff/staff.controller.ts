import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('mad/staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  /**
   * MAD-012 — POST /mad/staff
   * Creates a new staff account. Returns username and one-time temp password.
   * Only accessible by users with MANAGER role (enforced by JwtAuthGuard).
   */
  @Post()
  createStaff(@Body() dto: CreateStaffDto) {
    return this.staffService.create(dto);
  }
}
