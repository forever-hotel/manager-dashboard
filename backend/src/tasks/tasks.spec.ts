import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TasksQueryDto } from './tasks-query.dto';
import {
  parseTaskEvent,
  TaskEventsConsumer,
} from '../realtime/task-events.consumer';
import { RealtimeGateway } from '../realtime/realtime.gateway';
const id = '67f4568c-89ab-4c12-b321-123456789012';
const task = {
  id,
  roomNumber: '101',
  category: 'ROOM_CLEANING',
  priority: 'HIGH',
  status: 'UNASSIGNED',
  assignee: null,
  submittedAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
  completedAt: null,
  version: 2,
};
const event = {
  eventId: id,
  taskId: id,
  type: 'task.changed' as const,
  version: 2,
  occurredAt: task.updatedAt,
};
describe('DDP-042 task snapshots', () => {
  it('maps read-only snapshots, filters, pagination and the single-task source lookup', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ queried_at: new Date(), total: 1, tasks: [task] }]);
    const service = new TasksService({ query } as unknown as DataSource);
    const dto = Object.assign(new TasksQueryDto(), {
      status: 'UNASSIGNED',
      worker: id,
      page: 2,
      pageSize: 10,
    });
    expect(await new TasksController(service).list(dto)).toMatchObject({
      tasks: [task],
      source: 'WKMS',
      readOnly: true,
      page: 2,
    });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('SELECT'), [
      'UNASSIGNED',
      id,
      10,
      10,
      null,
    ]);
    expect(await service.find(id)).toEqual(task);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      null,
      null,
      20,
      0,
      id,
    ]);
    expect(() => new TasksController(service).denyMutation()).toThrow();
  });
  it('accepts completed tasks and empty sources; rejects malformed sources without disclosing SQL', async () => {
    const query = jest.fn();
    const service = new TasksService({ query } as unknown as DataSource);
    for (const tasks of [
      [],
      [task],
      [
        {
          ...task,
          status: 'COMPLETED',
          completedAt: task.updatedAt,
          assignee: { id, name: 'Worker' },
        },
      ],
    ]) {
      query.mockResolvedValueOnce([
        { queried_at: new Date(), total: tasks.length, tasks },
      ]);
      expect((await service.snapshot(new TasksQueryDto())).tasks).toEqual(
        tasks,
      );
    }
    for (const rows of [
      [],
      [{ total: -1, tasks: [] }],
      [{ total: 1, tasks: null }],
      ...[
        { id: 'bad' },
        { roomNumber: null },
        { roomNumber: '' },
        { category: 'BAD' },
        { priority: 'BAD' },
        { status: 'BAD' },
        { assignee: { id: 'bad', name: 'Worker' } },
        { assignee: { id, name: null } },
        { version: -1 },
        { version: 1.5 },
        { updatedAt: 'bad' },
        { submittedAt: 'bad' },
        { status: 'COMPLETED' },
        { status: 'COMPLETED', completedAt: 'bad' },
        { completedAt: task.updatedAt },
      ].map((patch) => [
        { queried_at: new Date(), total: 1, tasks: [{ ...task, ...patch }] },
      ]),
    ]) {
      query.mockResolvedValueOnce(rows);
      await expect(service.snapshot(new TasksQueryDto())).rejects.toMatchObject(
        { status: 503 },
      );
    }
    query.mockRejectedValue(new Error('private SQL'));
    await expect(service.snapshot(new TasksQueryDto())).rejects.toMatchObject({
      status: 503,
    });
  });
  it('validates states, worker UUID and bounded paging', async () => {
    expect(await validate(new TasksQueryDto())).toEqual([]);
    for (const raw of [
      { status: 'BAD' },
      { worker: 'bad' },
      { page: 0 },
      { page: 100001 },
      { pageSize: 101 },
      { pageSize: 0 },
      { page: 'x' },
      { extra: 1 },
    ]) {
      expect(
        (
          await validate(plainToInstance(TasksQueryDto, raw), {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        ).length,
      ).toBeGreaterThan(0);
    }
  });
  it('validates event envelopes and strips producer task data', () => {
    expect(parseTaskEvent({ ...event, task: { secret: 'hidden' } })).toEqual(
      event,
    );
    for (const raw of [
      null,
      'bad',
      {},
      ...[
        { type: 'other' },
        { eventId: 3 },
        { eventId: 'bad' },
        { taskId: 3 },
        { taskId: 'bad' },
        { version: -1 },
        { occurredAt: 3 },
        { occurredAt: 'bad' },
        { occurredAt: '2026-10-20T00:00:00' },
      ].map((patch) => ({ ...event, ...patch })),
    ])
      expect(() => parseTaskEvent(raw)).toThrow();
  });
  it('persists authoritative versions once and refuses missing or behind source data', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn(
      async (work: (m: { query: typeof query }) => Promise<void>) =>
        work({ query }),
    );
    const find = jest.fn().mockResolvedValue(task);
    const consumer = new TaskEventsConsumer(
      new ConfigService(),
      { transaction } as unknown as DataSource,
      {} as RealtimeGateway,
      { find } as unknown as TasksService,
    );
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([]);
    await consumer.accept(event);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO mad_task_versions'),
      [id, 2],
    );
    query
      .mockClear()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }]);
    await consumer.accept(event);
    expect(query).toHaveBeenCalledTimes(2);
    query
      .mockClear()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([{ version: '3' }]);
    await consumer.accept(event);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO mad_task_events'),
      expect.arrayContaining([true]),
    );
    find
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...task, version: 1 });
    await expect(consumer.accept(event)).rejects.toThrow();
    await expect(consumer.accept(event)).rejects.toThrow();
  });
  it('keeps pending delivery on socket failure and marks only successful publication', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ event_id: id, payload: event }]);
    const publishTask = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const consumer = new TaskEventsConsumer(
      new ConfigService(),
      { query } as unknown as DataSource,
      { publishTask } as unknown as RealtimeGateway,
      {} as TasksService,
    );
    await expect(consumer.dispatch()).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
    await consumer.dispatch();
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE mad_task_events'),
      [id],
    );
  });
});
