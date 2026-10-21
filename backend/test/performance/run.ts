import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { io, Socket } from 'socket.io-client';
import { percentile } from './metrics';

// Explicit invocation only. Never imported by Jest, application startup or CI.
const routes = [
  '/mad/analytics/overview',
  '/mad/analytics/bookings?period=day',
  '/mad/analytics/revenue?period=month',
  '/mad/analytics/food-orders?period=day',
  '/mad/analytics/service-requests?period=week',
  '/mad/analytics/worker-performance?period=month',
  '/mad/kitchen/orders',
  '/mad/rooms/status',
  '/mad/tasks',
  '/mad/notifications',
  '/mad/staff?page=1&pageSize=20',
  '/mad/complaints?page=1&pageSize=20',
  '/mad/promotions?page=1&pageSize=20',
];

async function main() {
  if (process.env.PERF_STAGING_APPROVED !== 'yes')
    throw new Error('Set PERF_STAGING_APPROVED=yes for approved staging only');
  const base = new URL(process.env.PERF_API_URL ?? '');
  const socketBase = new URL(process.env.PERF_SOCKET_URL ?? '');
  const origin = new URL(process.env.PERF_BROWSER_ORIGIN ?? '').origin;
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !['http:', 'https:'].includes(socketBase.protocol) ||
    [base, socketBase].some(
      (url) =>
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash,
    )
  )
    throw new Error('Use API/socket origins without credentials or path');
  const users = Number(process.env.PERF_USERS ?? 100);
  if (![100, 300].includes(users))
    throw new Error('PERF_USERS must be 100 or 300');
  const runLabel = process.env.PERF_RUN_LABEL;
  if (!runLabel || !/^[a-zA-Z0-9_-]{1,80}$/.test(runLabel))
    throw new Error('Provide a unique safe PERF_RUN_LABEL');
  const tokens: unknown = JSON.parse(
    await readFile(process.env.PERF_SESSIONS_FILE ?? '', 'utf8'),
  );
  if (
    !Array.isArray(tokens) ||
    tokens.length !== users ||
    !tokens.every(
      (token) => typeof token === 'string' && /^[\w.-]+$/.test(token),
    ) ||
    new Set(tokens).size !== users
  )
    throw new Error('Provide exactly one distinct active manager JWT per user');
  const sessions = tokens as string[];
  const dir = resolve('performance-results', runLabel);
  await mkdir(resolve('performance-results'), { recursive: true });
  // Reserve the label before making any network request.
  await mkdir(dir, { recursive: false });
  const startedAt = new Date().toISOString();
  const sockets: Socket[] = [];
  const durations: number[] = [];
  const perRoute = routes.map((path) => ({
    path,
    count: 0,
    errors: 0,
    times: [] as number[],
  }));
  const receipts: {
    eventId: string;
    type: string;
    clientId: string;
    receivedAt: number;
  }[] = [];
  const warmupMs = 300000;
  const measuredMs = 900000;
  let measurementStart = Infinity;
  let measurementEnd = Infinity;
  let stopping = false;
  let disconnects = 0;
  let errors = 0;
  let missedSlots = 0;
  let receiptOverflow = false;
  const measured = () =>
    performance.now() >= measurementStart && performance.now() < measurementEnd;
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  async function request(path: string, token: string, method = 'GET') {
    const response = await fetch(new URL(path, base), {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    const body = await response.text();
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    )
      throw new Error('Unexpected API response');
    return JSON.parse(body) as unknown;
  }
  const cancel = () => {
    stopping = true;
    sockets.forEach((socket) => socket.disconnect());
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    // Setup is intentionally paced, not counted as steady-state API traffic.
    for (let i = 0; i < users; i++) {
      if (stopping) throw new Error('Cancelled');
      const result = await request('/mad/realtime/ticket', sessions[i], 'POST');
      if (
        !result ||
        typeof result !== 'object' ||
        !('ticket' in result) ||
        typeof result.ticket !== 'string'
      )
        throw new Error('Invalid ticket response');
      const socket = io(socketBase.origin, {
        path: '/mad/socket.io',
        transports: ['websocket'],
        auth: { ticket: result.ticket },
        extraHeaders: { Origin: origin },
        reconnection: false,
        timeout: 10000,
        autoConnect: false,
      });
      sockets.push(socket);
      socket.on('disconnect', () => {
        if (!stopping) disconnects++;
      });
      socket.onAny((type: string, payload: unknown) => {
        if (
          !measured() ||
          !payload ||
          typeof payload !== 'object' ||
          !('eventId' in payload) ||
          typeof payload.eventId !== 'string'
        )
          return;
        if (receipts.length >= 1000000) {
          receiptOverflow = true;
          return;
        }
        receipts.push({
          type,
          eventId: payload.eventId,
          clientId: String(i),
          receivedAt: Date.now(),
        });
      });
      await new Promise<void>((done, reject) => {
        socket.once('connect', done);
        socket.once('connect_error', () =>
          reject(new Error('Socket setup failed')),
        );
        socket.connect();
      });
      await sleep(50);
    }
    const start = performance.now();
    measurementStart = start + warmupMs;
    measurementEnd = measurementStart + measuredMs;
    console.log(
      `Running ${users} API/socket sessions: 5-minute warm-up, 15-minute measurement.`,
    );
    await Promise.all(
      sessions.map(async (token, index) => {
        let slot = 0;
        while (!stopping) {
          const scheduled = start + index * (1000 / users) + slot * 1000;
          if (scheduled >= measurementEnd) break;
          await sleep(Math.max(0, scheduled - performance.now()));
          if (stopping || performance.now() >= measurementEnd) break;
          const inWindow = scheduled >= measurementStart;
          const routeIndex = (slot + index) % routes.length;
          const before = performance.now();
          let failed = false;
          try {
            await request(routes[routeIndex], token);
          } catch {
            failed = true;
          }
          if (inWindow) {
            const duration = performance.now() - before;
            durations.push(duration);
            perRoute[routeIndex].times.push(duration);
            perRoute[routeIndex].count++;
            if (failed) {
              errors++;
              perRoute[routeIndex].errors++;
            }
          }
          slot++;
          // Do not hide saturation by issuing catch-up bursts or lowering the target.
          const skipped = Math.max(
            0,
            Math.floor(
              (performance.now() - start - index * (1000 / users)) / 1000,
            ) - slot,
          );
          for (let n = 0; n < skipped; n++) {
            const skippedAt =
              start + index * (1000 / users) + (slot + n) * 1000;
            if (skippedAt >= measurementStart && skippedAt < measurementEnd)
              missedSlots++;
          }
          slot += skipped;
        }
      }),
    );
    const expectedRequests = (users * measuredMs) / 1000;
    const p95Ms = percentile(durations, 0.95);
    const summary = {
      schemaVersion: 1,
      profile: 'DDP-047-read-v1',
      runLabel,
      users,
      startedAt,
      apiOrigin: base.origin,
      socketOrigin: socketBase.origin,
      finishedAt: new Date().toISOString(),
      warmupMs,
      measuredMs,
      expectedRequests,
      requests: durations.length,
      errors,
      disconnects,
      missedSlots,
      p50Ms: percentile(durations, 0.5),
      p95Ms,
      p99Ms: percentile(durations, 0.99),
      maxMs: durations.length
        ? durations.reduce((a, b) => Math.max(a, b), 0)
        : null,
      within500Fraction: durations.length
        ? durations.filter((ms) => ms <= 500).length / durations.length
        : null,
      completed:
        !stopping && durations.length === expectedRequests && missedSlots === 0,
      receiptOverflow,
      apiGate:
        !stopping &&
        durations.length === expectedRequests &&
        missedSlots === 0 &&
        errors === 0 &&
        disconnects === 0 &&
        !receiptOverflow &&
        p95Ms !== null &&
        p95Ms <= 500,
      // AC2/render and AC3 baseline/owner sign-off require separate evidence.
      acceptance: 'PENDING_REVIEW',
      routes: perRoute.map(({ times, ...route }) => ({
        ...route,
        p95Ms: percentile(times, 0.95),
        p99Ms: percentile(times, 0.99),
      })),
    };
    await writeFile(
      resolve(dir, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
    await writeFile(resolve(dir, 'receipts.json'), JSON.stringify(receipts));
    console.log(
      `Sanitized results: performance-results/${runLabel}; API gate ${summary.apiGate ? 'passed' : 'failed'}. Full acceptance remains pending.`,
    );
    if (!summary.apiGate) process.exitCode = 1;
  } finally {
    cancel();
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

void main().catch(() => {
  // Never print fetch errors, private file contents, tokens or ticket payloads.
  console.error(
    'Performance run failed. Check approved origins, sessions, permissions and output path using the runbook.',
  );
  process.exitCode = 1;
});
