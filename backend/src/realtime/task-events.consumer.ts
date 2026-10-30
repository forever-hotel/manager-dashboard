import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isISO8601, isUUID } from 'class-validator';
import { connect, ChannelModel, Channel } from 'amqplib';
import { DataSource } from 'typeorm';
import { RealtimeGateway } from './realtime.gateway';
import { TasksService } from '../tasks/tasks.service';
import type { WorkerTask } from '../tasks/tasks.service';

export interface TaskEvent {
  eventId: string;
  type: 'task.changed';
  taskId: string;
  version: number;
  occurredAt: string;
  task?: WorkerTask;
}

export function parseTaskEvent(raw: unknown): TaskEvent {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid event');
  const e = raw as Record<string, unknown>;

  if (
    e.type !== 'task.changed' ||
    typeof e.eventId !== 'string' ||
    !isUUID(e.eventId) ||
    typeof e.taskId !== 'string' ||
    !isUUID(e.taskId) ||
    !Number.isSafeInteger(e.version) ||
    Number(e.version) < 0 ||
    typeof e.occurredAt !== 'string' ||
    !isISO8601(e.occurredAt, { strict: true }) ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(e.occurredAt)
  )
    throw new Error('Invalid event');
  return {
    eventId: e.eventId,
    type: e.type,
    taskId: e.taskId,
    version: Number(e.version),
    occurredAt: e.occurredAt
  };
}

@Injectable()
export class TaskEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: Channel;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource,
    private readonly gateway: RealtimeGateway,
    private readonly tasks: TasksService
  ) {}

  onModuleInit() {
    if (this.config.get<string>('MAD_REALTIME_ENABLED') === 'true') void this.tick();
  }

  async accept(event: TaskEvent) {
    const task = await this.tasks.find(event.taskId);
    // Do not acknowledge an event until its committed source version is visible.
    if (!task || task.version < event.version) throw new Error('Task source unavailable or behind event');
    event = { ...event, version: task.version, task };
    await this.database.transaction(async manager => {
      // Transaction-level lock serializes versions for one task across consumers.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [event.taskId]);
      const [seen] = await manager.query<{ exists: boolean }[]>(
        'SELECT EXISTS(SELECT 1 FROM mad_task_events WHERE event_id=$1) AS exists',
        [event.eventId]
      );

      if (seen.exists) return;
      const [last] = await manager.query<{ version: string }[]>(
        'SELECT version FROM mad_task_versions WHERE task_id=$1',
        [event.taskId]
      );
      const stale = last && Number(last.version) >= event.version;

      await manager.query(
        'INSERT INTO mad_task_events(event_id,task_id,version,payload,delivered_at) VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END)',
        [event.eventId, event.taskId, event.version, JSON.stringify(event), Boolean(stale)]
      );
      if (!stale)
        await manager.query(
          'UPDATE mad_task_events SET delivered_at=now() WHERE task_id=$1 AND version<$2 AND delivered_at IS NULL',
          [event.taskId, event.version]
        );
      if (!stale)
        await manager.query(
          'INSERT INTO mad_task_versions(task_id,version) VALUES ($1,$2) ON CONFLICT(task_id) DO UPDATE SET version=EXCLUDED.version',
          [event.taskId, event.version]
        );
    });
  }

  private async attach() {
    const url = this.config.get<string>('RABBITMQ_URL');

    if (!url) throw new Error('Missing broker');
    const connection = await connect(url, { timeout: 5000 });

    if (this.stopped) {
      await connection.close();
      throw new Error('Stopped');
    }
    this.connection = connection;
    connection.on('error', () => {
      this.gateway.tasksHealthy = false;
    });
    connection.on('close', () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.channel = undefined;
        this.gateway.tasksHealthy = false;
      }
    });
    const channel = await connection.createChannel();

    this.channel = channel;
    channel.on('error', () => {
      this.gateway.tasksHealthy = false;
    });
    channel.on('close', () => {
      if (this.channel === channel) {
        this.channel = undefined;
        this.gateway.tasksHealthy = false;
      }
    });
    await channel.assertExchange('hotel.events', 'topic', { durable: true });
    await channel.assertQueue('mad.tasks.dead', { durable: true });
    await channel.assertQueue('mad.tasks', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'mad.tasks.dead'
      }
    });
    await channel.bindQueue('mad.tasks', 'hotel.events', 'task.changed');
    await channel.prefetch(1);
    await channel.consume(
      'mad.tasks',
      message => {
        if (!message) {
          this.gateway.tasksHealthy = false;
          void connection.close().catch(() => undefined);
          return;
        }
        let event: TaskEvent;

        try {
          if (message.content.length > 8192) throw new Error();
          event = parseTaskEvent(JSON.parse(message.content.toString()) as unknown);
        } catch {
          channel.nack(message, false, false);
          return;
        }
        void this.accept(event)
          .then(
            () => {
              channel.ack(message);
            },
            () => {
              // Closing requeues unacknowledged delivery without a tight retry loop.
              this.gateway.tasksHealthy = false;
              void connection.close().catch(() => undefined);
            }
          )
          .catch(() => {
            this.gateway.tasksHealthy = false;
          });
      },
      { noAck: false }
    );
  }

  async dispatch() {
    const rows = await this.database.query<{ event_id: string; payload: TaskEvent }[]>(
      'SELECT event_id,payload FROM mad_task_events WHERE delivered_at IS NULL ORDER BY received_at,event_id LIMIT 100'
    );

    for (const row of rows) {
      await this.gateway.publishTask(row.payload);
      await this.database.query('UPDATE mad_task_events SET delivered_at=now() WHERE event_id=$1', [row.event_id]);
    }
  }

  private async tick() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      if (!this.channel) {
        await this.connection?.close().catch(() => undefined);
        await this.attach();
      }
      await this.dispatch();
      this.gateway.tasksHealthy = Boolean(this.channel);
    } catch {
      this.gateway.tasksHealthy = false;
      await this.connection?.close().catch(() => undefined);
      this.connection = undefined;
      this.channel = undefined;
    } finally {
      this.busy = false;
      if (!this.stopped) {
        this.timer = setTimeout(
          () => {
            void this.tick();
          },
          this.gateway.tasksHealthy ? 250 : 5000
        );
        this.timer.unref();
      }
    }
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.connection?.close().catch(() => undefined);
  }
}
