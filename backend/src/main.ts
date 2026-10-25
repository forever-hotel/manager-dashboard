import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureHttp } from './common/http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });
  // ConfigModule has loaded .env before choosing the final logger format.
  app.useLogger(
    new ConsoleLogger({
      json: process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production'
    })
  );
  configureHttp(app);
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
