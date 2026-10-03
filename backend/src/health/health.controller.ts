import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller(['health', 'mad/health'])
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  constructor(private readonly database: DataSource) {}
  @Get('live')
  live() {
    return { status: 'ok', service: 'mad-backend' };
  }
  @Get('ready')
  async ready() {
    let dependency = 'public.mad_revoked_sessions';
    try {
      await this.database.query(
        'SELECT token_hash FROM public.mad_revoked_sessions LIMIT 0',
      );
      dependency = 'public.staff_users';
      await this.database.query(
        'SELECT worker_id, role, is_active, password_change_required, session_version, failed_attempts, locked_until FROM public.staff_users LIMIT 0',
      );
      return { status: 'ok', service: 'mad-backend', database: 'ready' };
    } catch (error: unknown) {
      const failure = error as {
        code?: unknown;
        driverError?: { code?: unknown };
      } | null;
      const candidate = failure?.driverError?.code ?? failure?.code;
      const postgresCode =
        typeof candidate === 'string' && /^[0-9A-Z]{5}$/.test(candidate)
          ? candidate
          : 'unknown';
      // Only fixed dependency names and a SQLSTATE are logged, never driver
      // messages, query parameters, connection details or error stacks.
      this.logger.error({
        event: 'readiness_dependency_failed',
        dependency,
        postgresCode,
      });
      throw new ServiceUnavailableException();
    }
  }
}
