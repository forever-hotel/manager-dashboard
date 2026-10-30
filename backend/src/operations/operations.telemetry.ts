import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';

const logger = new Logger('Operations');
const resources = [
  'staff',
  'promotions',
  'complaints',
  'notifications',
  'analytics',
  'reports',
  'rooms',
  'tasks',
  'kitchen',
  'realtime'
] as const;

export function resource(path: string) {
  if (/^\/(?:mad\/)?auth(?:\/|$)/.test(path)) return 'authentication';
  return resources.find(name => path === '/mad/' + name || path.startsWith('/mad/' + name + '/')) ?? 'other';
}

export class OperationsTelemetry {
  constructor(
    private readonly sink: (record: object) => void = record => logger.log(record),
    private readonly clock: () => number = () => performance.now()
  ) {}

  private emit(record: object) {
    try {
      this.sink(record);
    } catch {
      // Audit sink failures must not interrupt application requests.
    }
  }

  observe(request: Request, response: Response, next: NextFunction) {
    const correlationId = randomUUID();
    const start = this.clock();

    response.setHeader('X-Correlation-ID', correlationId);
    let recorded = false;
    const complete = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const elapsed = Math.max(0, this.clock() - start);

      if (!aborted && response.statusCode < 400 && ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
      const suppliedActor: unknown = (request as Request & { user?: { sub?: unknown } }).user?.sub;
      const actor =
        typeof suppliedActor === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(suppliedActor)
          ? suppliedActor
          : 'anonymous';

      this.emit({
        timestamp: new Date().toISOString(),
        service: 'mad-backend',
        event: 'http.operation',
        actorId: actor,
        correlationId,
        resource: resource(request.path),
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(request.method)
          ? request.method
          : 'OTHER',
        status: aborted ? null : response.statusCode,
        outcome: aborted
          ? 'UNKNOWN_ABORTED'
          : response.statusCode < 400
            ? 'SUCCESS'
            : [401, 403].includes(response.statusCode)
              ? 'DENIED'
              : 'FAILED',
        durationMs: Math.round(elapsed)
      });
    };

    response.once('finish', () => complete(false));
    response.once('close', () => complete(!response.writableFinished));
    next();
  }
}
export const operationsTelemetry = new OperationsTelemetry();
