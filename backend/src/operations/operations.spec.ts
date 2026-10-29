import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { OperationsTelemetry, resource } from './operations.telemetry';

describe('DDP-050 structured audit and health', () => {
  const actor = '12345678-1234-4234-8234-123456789012';
  function response(statusCode = 200) {
    return Object.assign(new EventEmitter(), {
      statusCode,
      writableFinished: true,
      setHeader: jest.fn()
    });
  }
  it.each([
    ['POST', 200, 'SUCCESS'],
    ['PATCH', 409, 'FAILED'],
    ['DELETE', 403, 'DENIED'],
    ['GET', 503, 'FAILED'],
    ['OTHER', 400, 'FAILED']
  ])('records safe %s/%s outcomes', (method, code, outcome) => {
    const sink = jest.fn();
    const telemetry = new OperationsTelemetry(sink);
    const res = response(Number(code));
    const req = {
      method,
      path: '/mad/staff/' + actor,
      user: { sub: actor },
      body: { password: 'DO-NOT-LOG', note: 'private-note' },
      headers: {
        authorization: 'secret-token',
        'x-correlation-id': 'untrusted'
      }
    };
    const next = jest.fn();
    telemetry.observe(req as unknown as Request, res as unknown as Response, next);
    res.emit('finish');
    res.emit('close');
    expect(next).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'mad-backend',
        actorId: actor,
        resource: 'staff',
        outcome,
        correlationId: expect.any(String) as unknown,
        timestamp: expect.any(String) as unknown
      })
    );
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/DO-NOT-LOG|private-note|secret-token|untrusted/);
    expect(telemetry.snapshot().requests).toBe(1);
  });
  it('distinguishes anonymous aborted outcomes and bounds metric labels/buckets', () => {
    let now = 0;
    const sink = jest.fn();
    const telemetry = new OperationsTelemetry(sink, () => now);
    const res = response();
    res.writableFinished = false;
    telemetry.observe(
      {
        method: 'POST',
        path: '/bad/private-email',
        user: { sub: 'private-email' }
      } as unknown as Request,
      res as unknown as Response,
      () => {}
    );
    now = 6001;
    res.emit('close');
    res.emit('finish');
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'anonymous',
        outcome: 'UNKNOWN_ABORTED',
        status: null,
        resource: 'other'
      })
    );
    expect(telemetry.snapshot()).toMatchObject({
      serverFailures: 1,
      uptimeSeconds: 6
    });
    expect(telemetry.snapshot().latencyBuckets).toContainEqual({
      upperBoundMs: null,
      count: 1
    });
  });
  it('counts successful reads without generating audit noise and isolates sink failures', () => {
    const sink = jest.fn(() => {
      throw new Error('private sink error');
    });
    const telemetry = new OperationsTelemetry(sink);
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST']) {
      const res = response();
      telemetry.observe({ method, path: '/mad/staff' } as Request, res as unknown as Response, () => {});
      expect(() => res.emit('finish')).not.toThrow();
    }
    expect(telemetry.snapshot()).toMatchObject({
      requests: 4,
      auditWriteFailures: 1
    });
  });
  it('classifies fixed resources without reflecting arbitrary paths or values', () => {
    expect(resource('/auth/login')).toBe('authentication');
    expect(resource('/mad/auth/logout')).toBe('authentication');
    expect(resource('/mad/promotions/secret')).toBe('promotions');
    expect(resource('/mad/staffish')).toBe('other');
  });
});
