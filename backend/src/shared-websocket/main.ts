import 'reflect-metadata';
import { Controller, Get, Headers, Module, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SharedAuthService } from './shared-auth.service';
import { SharedGateway } from './shared.gateway';
import { SharedBroker } from './shared-broker.service';
@Controller()
class SharedController {
  constructor(
    private readonly gateway: SharedGateway,
    private readonly broker: SharedBroker
  ) {}
  @Get('health/ready') ready() {
    if (!this.broker.ready) throw new ServiceUnavailableException();
    return { status: 'ok', service: 'shared-websocket' };
  }
  @Post('internal/tickets/:subsystem') ticket(
    @Param('subsystem') subsystem: string,
    @Headers('authorization') authorization = '',
    @Headers('x-relay-key') key = ''
  ) {
    return this.gateway.ticket(subsystem, authorization.startsWith('Bearer ') ? authorization.slice(7) : '', key);
  }
}
@Module({ controllers: [SharedController], providers: [SharedAuthService, SharedGateway, SharedBroker] })
class SharedWebsocketModule {}
export { SharedWebsocketModule };
export async function startSharedWebsocket() {
  const app = await NestFactory.create(SharedWebsocketModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4700), '0.0.0.0');
  return app;
}
if (require.main === module) void startSharedWebsocket();
