import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const codes: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE',
    };
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const custom =
      typeof body === 'object' && body !== null
        ? (body as { code?: string; message?: unknown })
        : null;
    const message =
      status >= 500
        ? 'Service temporarily unavailable. Please retry.'
        : status === 401
          ? 'Please sign in again.'
          : typeof custom?.message === 'string'
            ? custom.message
            : 'The request could not be processed.';
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        code: custom?.code ?? codes[status] ?? 'INTERNAL_ERROR',
        message,
        ...(status === 400 && Array.isArray(custom?.message)
          ? { details: custom.message }
          : {}),
      });
  }
}

export function configureHttp(app: INestApplication) {
  // Authentication responses and protected data must never be cached by intermediaries.
  app.use((_request: unknown, response: Response, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
  app.enableShutdownHooks();
}
