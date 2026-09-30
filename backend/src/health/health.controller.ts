import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller(['health', 'mad/health'])
export class HealthController {
  constructor(private readonly database: DataSource) {}
  @Get('live')
  live() {
    return { status: 'ok', service: 'mad-backend' };
  }
  @Get('ready')
  async ready() {
    try {
      await this.database.query(
        'SELECT token_hash FROM mad_revoked_sessions LIMIT 0',
      );
      await this.database.query('SELECT manager_id FROM mad_manager_accounts LIMIT 0');
      return { status: 'ok', service: 'mad-backend', database: 'ready' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
