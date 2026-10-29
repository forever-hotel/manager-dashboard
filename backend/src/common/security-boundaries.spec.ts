import { INestApplication, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { configureHttp } from './http';
import { AnalyticsController } from '../analytics/analytics.controller';
import { FoodAnalyticsController } from '../analytics/food-analytics.controller';
import { ServiceRequestAnalyticsController } from '../analytics/service-request-analytics.controller';
import { WorkerPerformanceController } from '../analytics/worker-performance.controller';
import { ComplaintsController } from '../complaints/complaints.controller';
import { KitchenController } from '../kitchen/kitchen.controller';
import { PromotionsController } from '../promotions/promotions.controller';
import { RealtimeController } from '../realtime/realtime.controller';
import { ReportsController } from '../reports/reports.controller';
import { RoomsController } from '../rooms/rooms.controller';
import { StaffController } from '../staff/staff.controller';
import { TasksController } from '../tasks/tasks.controller';
import { NotificationsController } from '../notifications/notifications.controller';
// Real JWT/guard/session logic with isolated storage; feature e2e suites cover PostgreSQL.
const controllers = [
  AnalyticsController,
  FoodAnalyticsController,
  ServiceRequestAnalyticsController,
  WorkerPerformanceController,
  ComplaintsController,
  KitchenController,
  PromotionsController,
  RealtimeController,
  ReportsController,
  RoomsController,
  StaffController,
  TasksController,
  NotificationsController
];
const routes = controllers.flatMap(controller => {
  const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
  return Object.getOwnPropertyNames(controller.prototype).flatMap(name => {
    const handler = controller.prototype[name] as object;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) return [];
    const paths = Reflect.getMetadata(PATH_METADATA, handler) as string | string[];
    return (Array.isArray(paths) ? paths : [paths]).map(path => ({
      controller,
      method: method === RequestMethod.ALL ? 'post' : RequestMethod[method].toLowerCase(),
      path:
        '/' +
        [prefix, path]
          .map(part => part.replace(/^\/+|\/+$/g, ''))
          .filter(Boolean)
          .join('/')
          .replace(':id', '12345678-1234-4234-8234-123456789012')
          .replace(':type', 'bookings')
    }));
  });
});
describe('DDP-035 protected REST boundaries', () => {
  let app: INestApplication<App>;
  const secret = 'security-boundary-only-secret-with-32-characters';
  const jwt = new JwtService();
  const account = {
    worker_id: '12345678-1234-4234-8234-123456789012',
    role: 'WORKER',
    is_active: true,
    session_version: 0
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers,
      providers: [
        AuthService,
        TokenService,
        JwtAuthGuard,
        {
          provide: DataSource,
          useValue: { query: jest.fn().mockResolvedValue([account]) }
        },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (name: string) => (name === 'JWT_SECRET' ? secret : 'mad')
          }
        }
      ]
    })
      .useMocker(() => ({}))
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  function token(expired = false) {
    const now = Math.floor(Date.now() / 1000) - (expired ? 30000 : 0);
    return jwt.sign(
      {
        sub: account.worker_id,
        jti: account.worker_id,
        role: 'WORKER',
        ver: 0,
        iat: now,
        exp: now + 28800
      },
      { secret, issuer: 'mad', audience: 'mad', algorithm: 'HS256' }
    );
  }
  it.each(routes)(
    '$method $path rejects missing, malformed, expired and disallowed-role sessions',
    async ({ controller, method, path }) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(JwtAuthGuard);
      for (const [authorization, status] of [
        [undefined, 401],
        ['Bearer invalid', 401],
        ['Bearer ' + token(true), 401],
        ['Bearer ' + token(), 403]
      ] as const) {
        const client = request(app.getHttpServer());
        const send = client[method as 'get' | 'post' | 'put' | 'patch' | 'delete'](path);
        if (authorization) send.set('Authorization', authorization);
        const response = await send.send({}).expect(status);
        expect((response.body as { code: string }).code).toBe(status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN');
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
      }
    }
  );
});
