import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ComplaintQueryDto, ResolveComplaintDto } from './complaint.dto';
import { ComplaintsService } from './complaints.service';

@Controller('mad/complaints')
@UseGuards(JwtAuthGuard)
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get() list(@Query() query: ComplaintQueryDto) {
    return this.complaints.list(query);
  }

  @Get(':id') detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.complaints.detail(id);
  }

  @Patch(':id') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
    @Body() input: ResolveComplaintDto
  ) {
    return this.complaints.update(id, request.user.sub, input);
  }
}
