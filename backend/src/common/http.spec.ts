import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  INestApplication,
} from '@nestjs/common';
import { ApiExceptionFilter, configureHttp } from './http';
describe('Stable error envelope', () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  beforeEach(() => jest.clearAllMocks());
  it.each([
    [new Error('private secret'), 500, 'INTERNAL_ERROR'],
    [new HttpException('private outage', 503), 503, 'SERVICE_UNAVAILABLE'],
    [new HttpException('unauthorized', 401), 401, 'UNAUTHENTICATED'],
    [new HttpException('missing', 404), 404, 'NOT_FOUND'],
    [new HttpException('unusual', 418), 418, 'INTERNAL_ERROR'],
    [
      new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change password',
      }),
      403,
      'PASSWORD_CHANGE_REQUIRED',
    ],
    [
      new BadRequestException(['username must be a string']),
      400,
      'VALIDATION_ERROR',
    ],
  ])(
    'redacts and normalizes exception %s',
    (exception, expectedStatus, code) => {
      new ApiExceptionFilter().catch(exception, host);
      expect(status).toHaveBeenCalledWith(expectedStatus);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code }));
      expect(JSON.stringify(json.mock.calls)).not.toContain('private');
    },
  );
  it('applies identical global validation and filters to production and tests', () => {
    const app = {
      useGlobalPipes: jest.fn(),
      useGlobalFilters: jest.fn(),
      enableCors: jest.fn(),
      enableShutdownHooks: jest.fn(),
    };
    configureHttp(app as unknown as INestApplication);
    expect(app.useGlobalPipes).toHaveBeenCalled();
    expect(app.useGlobalFilters).toHaveBeenCalledWith(
      expect.any(ApiExceptionFilter),
    );
  });
});
