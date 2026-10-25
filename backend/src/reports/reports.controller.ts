import { Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { parseReportQuery, ReportType } from './report-query';
import { ReportsService } from './reports.service';
@Controller('mad/reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get(':type') async download(
    @Param('type') type: string,
    @Query() raw: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response
  ) {
    const query = parseReportQuery(type, raw);
    const result = await this.reports.download(type as ReportType, query);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(result.buffer, {
      type: result.contentType,
      disposition: `attachment; filename="${result.filename}"`,
      length: result.buffer.length
    });
  }
}
