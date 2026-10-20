import type { StockUpdate } from '../stock/stock-event';
import type { TaskEvent } from './task-events.consumer';
import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { randomBytes } from 'node:crypto';
import { Server, Socket } from 'socket.io';
import type { RoomEvent } from './room-events.consumer';
import { AuthService } from '../auth/auth.service';

export interface KitchenEvent {
  eventId: string;
  type: 'kitchen.order.changed';
  orderId: string;
  version: number;
  occurredAt: string;
}

@Injectable()
@WebSocketGateway({
  path: '/mad/socket.io',
  transports: ['websocket'],
  maxHttpBufferSize: 8192,
  serveClient: false,
})
export class RealtimeGateway implements OnGatewayInit, OnModuleDestroy {
  private server?: Server;
  private readonly tickets = new Map<
    string,
    { token: string; expires: number }
  >();
  private readonly sessions = new Map<Socket, string>();
  private timer?: ReturnType<typeof setInterval>;
  healthy = false;
  roomsHealthy = false;
  tasksHealthy = false;
  stockHealthy = false;
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}
  ticket(token: string) {
    const now = Date.now();
    for (const [key, t] of this.tickets)
      if (t.expires < now) this.tickets.delete(key);
    if (this.tickets.size >= 1000) throw new ServiceUnavailableException();
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { token, expires: now + 30000 });
    return { ticket, expiresIn: 30 };
  }
  afterInit(server: Server) {
    this.server = server;
    server.use((socket, next) => {
      const data = socket.handshake.auth as { ticket?: unknown };
      const key = typeof data.ticket === 'string' ? data.ticket : '';
      const entry = this.tickets.get(key);
      this.tickets.delete(key);
      if (
        socket.handshake.headers.origin !==
          this.config.get<string>('FRONTEND_URL') ||
        !entry ||
        entry.expires < Date.now()
      )
        return next(new Error('UNAUTHENTICATED'));
      void this.auth.session(entry.token).then(
        () => {
          this.sessions.set(socket, entry.token);
          next();
        },
        () => next(new Error('UNAUTHENTICATED')),
      );
    });
    server.on('connection', (socket) => {
      socket.emit('transport.status', { healthy: this.healthy });
      socket.emit('rooms.transport.status', { healthy: this.roomsHealthy });
      socket.emit('tasks.transport.status', { healthy: this.tasksHealthy });
      socket.emit('stock.transport.status', { healthy: this.stockHealthy });
      socket.on('disconnect', () => this.sessions.delete(socket));
    });
    this.timer = setInterval(() => {
      void this.send('transport.status', { healthy: this.healthy });
      void this.send('rooms.transport.status', { healthy: this.roomsHealthy });
      void this.send('tasks.transport.status', { healthy: this.tasksHealthy });
      void this.send('stock.transport.status', { healthy: this.stockHealthy });
    }, 5000);
    this.timer.unref();
  }
  async send(name: string, data: unknown) {
    await Promise.all(
      [...this.sessions].map(async ([socket, token]) => {
        try {
          await this.auth.session(token);
          if (socket.connected) socket.emit(name, data);
          else this.sessions.delete(socket);
        } catch {
          this.sessions.delete(socket);
          socket.disconnect(true);
        }
      }),
    );
  }
  async publish(event: KitchenEvent) {
    if (!this.server) throw new ServiceUnavailableException();
    await this.send('kitchen.order.changed', event);
  }
  async publishRoom(event: RoomEvent) {
    if (!this.server) throw new ServiceUnavailableException();
    await this.send('room.status.changed', event);
  }
  async publishTask(event: TaskEvent) {
    if (!this.server) throw new ServiceUnavailableException();
    await this.send('task.changed', event);
  }
  async publishStock(event: StockUpdate) {
    if (!this.server) throw new ServiceUnavailableException();
    await this.send('stock.alert.changed', event);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
    this.tickets.clear();
    this.sessions.clear();
  }
}
