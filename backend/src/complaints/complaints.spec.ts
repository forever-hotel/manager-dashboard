import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import {
  ComplaintQueryDto,
  COMPLAINT_STATUSES,
  ResolveComplaintDto,
} from './complaint.dto';
import {
  ComplaintRow,
  complaintView,
  ComplaintsService,
  requireTransition,
} from './complaints.service';

const id = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-16T00:00:00Z');
const row: ComplaintRow = {
  id,
  category: 'Room',
  description: 'Guest description',
  referencedWorkerId: null,
  submittedAt: now,
  status: 'SUBMITTED',
  resolvedAt: null,
  version: 0,
};
const input: ResolveComplaintDto = {
  version: 0,
  status: 'UNDER_REVIEW',
  note: 'Internal note',
};
function setup() {
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>();
  const transaction = jest.fn(
    (first: unknown, second?: (m: EntityManager) => Promise<unknown>) => {
      const work = (second ?? first) as (m: EntityManager) => Promise<unknown>;
      return work({ query } as unknown as EntityManager);
    },
  );
  return {
    query,
    transaction,
    service: new ComplaintsService(
      { query, transaction } as unknown as DataSource,
      () => now,
    ),
  };
}
describe('DDP-021 validation and transition rules', () => {
  it('normalizes a note and accepts exact filters and pagination', async () => {
    const patch = plainToInstance(ResolveComplaintDto, {
      ...input,
      note: '  private\n note  ',
    });
    expect(patch.note).toBe('private\n note');
    expect(await validate(patch)).toHaveLength(0);
    const query = plainToInstance(ComplaintQueryDto, {
      page: '2',
      pageSize: '10',
      status: 'RESOLVED',
      category: ' Room ',
      workerId: id,
    });
    expect(await validate(query)).toHaveLength(0);
    expect(query.page).toBe(2);
    expect(query.category).toBe('Room');
    expect(await validate(new ComplaintQueryDto())).toHaveLength(0);
  });
  it.each([
    { version: -1 },
    { version: 2147483647 },
    { version: '0' },
    { version: null },
    { note: '' },
    { note: '   ' },
    { note: 'x'.repeat(4001) },
    { note: '\u0000' },
    { note: null },
    { status: 'SUBMITTED' },
    { status: 'CLOSED' },
  ])('rejects invalid patch %j', async (change) => {
    expect(
      (
        await validate(
          plainToInstance(ResolveComplaintDto, { ...input, ...change }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each([
    { page: '0' },
    { page: '1.1' },
    { page: ['1', '2'] },
    { page: '1000001' },
    { pageSize: '101' },
    { status: 'bad' },
    { category: '' },
    { workerId: 'bad' },
  ])('rejects invalid filter %j', async (change) => {
    expect(
      (await validate(plainToInstance(ComplaintQueryDto, change))).length,
    ).toBeGreaterThan(0);
  });
  it('allows exactly two forward transitions', () => {
    for (const from of COMPLAINT_STATUSES)
      for (const to of ['UNDER_REVIEW', 'RESOLVED'] as const) {
        if (
          (from === 'SUBMITTED' && to === 'UNDER_REVIEW') ||
          (from === 'UNDER_REVIEW' && to === 'RESOLVED')
        )
          expect(() => requireTransition(from, to)).not.toThrow();
        else expect(() => requireTransition(from, to)).toThrow();
      }
  });
  it('projects safe fields rather than serializing private columns', () => {
    const view = complaintView({
      ...row,
      note: 'private',
      resolution_notes: 'private',
    } as ComplaintRow);
    expect(JSON.stringify(view)).not.toContain('private');
    expect(view.resolvedAt).toBeNull();
    expect(complaintView({ ...row, resolvedAt: now }).resolvedAt).toBe(
      now.toISOString(),
    );
  });
});
describe('DDP-021 complaint service', () => {
  it('lists a stable paginated snapshot with parameterized filters and no notes', async () => {
    const { service, query, transaction } = setup();
    query.mockResolvedValueOnce([{ total: '1' }]).mockResolvedValueOnce([row]);
    expect(
      await service.list({
        page: 2,
        pageSize: 5,
        category: "Room'",
        status: 'SUBMITTED',
        workerId: id,
      }),
    ).toEqual({ items: [complaintView(row)], total: 1, page: 2, pageSize: 5 });
    expect(query.mock.calls[1][1]).toEqual(['SUBMITTED', "Room'", id, 5, 5]);
    expect(query.mock.calls[1][0]).not.toContain("Room'");
    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
  });
  it('returns an empty unfiltered page', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([{ total: '0' }]).mockResolvedValueOnce([]);
    expect((await service.list(new ComplaintQueryDto())).items).toEqual([]);
  });
  it('reads manager-only history with timestamps', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([row]).mockResolvedValueOnce([
      {
        version: 1,
        fromStatus: 'SUBMITTED',
        status: 'UNDER_REVIEW',
        note: 'private',
        actorId: id,
        recordedAt: now,
      },
    ]);
    expect((await service.detail(id)).history[0]).toMatchObject({
      note: 'private',
      recordedAt: now.toISOString(),
    });
  });
  it('rejects unknown details and sanitizes storage errors', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([]);
    await expect(service.detail(id)).rejects.toMatchObject({ status: 404 });
    query.mockRejectedValue(new Error('secret'));
    await expect(service.detail(id)).rejects.toMatchObject({ status: 503 });
  });
  it.each(['UNDER_REVIEW', 'RESOLVED'] as const)(
    'saves %s with server actor/time and note-free event',
    async (status) => {
      const { service, query } = setup();
      const current = {
        ...row,
        status: status === 'RESOLVED' ? 'UNDER_REVIEW' : 'SUBMITTED',
      };
      query
        .mockResolvedValueOnce([current])
        .mockResolvedValueOnce(status === 'RESOLVED' ? [{ version: 1 }] : [])
        .mockResolvedValue([]);
      const version = status === 'RESOLVED' ? 1 : 0;
      const result = await service.update(id, id, {
        ...input,
        version,
        status,
      });
      expect(result).toMatchObject({
        status,
        version: version + 1,
        resolvedAt: status === 'RESOLVED' ? now.toISOString() : null,
      });
      expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(query.mock.calls[1][0]).toContain('SELECT version');
      expect(query.mock.calls[4][1]).toEqual([
        id,
        version + 1,
        current.status,
        status,
        input.note,
        id,
        now,
      ]);
      expect(JSON.stringify(query.mock.calls[5][1])).not.toContain(input.note);
      expect(query.mock.calls[2][0]).not.toContain('resolution_notes');
    },
  );
  it('rejects unknown, stale and illegal changes before writes', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([]);
    await expect(service.update(id, id, input)).rejects.toMatchObject({
      status: 404,
    });
    query
      .mockReset()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ version: 1 }]);
    await expect(service.update(id, id, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(query).toHaveBeenCalledTimes(2);
    query
      .mockReset()
      .mockResolvedValueOnce([{ ...row, status: 'RESOLVED' }])
      .mockResolvedValueOnce([]);
    await expect(service.update(id, id, input)).rejects.toMatchObject({
      status: 400,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('propagates an outbox failure for transactional rollback without exposing notes', async () => {
    const { service, query } = setup();
    query
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('private note'));
    await expect(service.update(id, id, input)).rejects.toMatchObject({
      status: 503,
      message: 'Service Unavailable',
    });
  });
});
