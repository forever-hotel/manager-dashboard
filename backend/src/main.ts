import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttp } from './common/http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureHttp(app);
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
