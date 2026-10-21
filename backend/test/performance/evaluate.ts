import { readFile } from 'node:fs/promises';
import { evaluateTimings, TimingEvidence } from './metrics';

interface Summary {
  schemaVersion: number;
  profile: string;
  users: number;
  apiGate: boolean;
  completed: boolean;
  p95Ms: number;
}

async function json(path: string | undefined): Promise<unknown> {
  if (!path) throw new Error('Missing evidence file');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function summary(value: unknown, users: number): Summary {
  const s = value as Summary | null;
  if (
    !s ||
    s.schemaVersion !== 1 ||
    s.profile !== 'DDP-047-read-v1' ||
    s.users !== users ||
    s.apiGate !== true ||
    s.completed !== true ||
    !Number.isFinite(s.p95Ms) ||
    s.p95Ms <= 0
  )
    throw new Error('Invalid or failed API summary');
  return s;
}

async function main() {
  const baseline = summary(await json(process.env.PERF_BASELINE_FILE), 100);
  const capacity = summary(await json(process.env.PERF_CAPACITY_FILE), 300);
  const uiBudgetMs = Number(process.env.PERF_UI_BUDGET_MS);
  // Structural validation occurs in evaluateTimings; malformed evidence also
  // exits nonzero. Source clocks and correlation require independent review.
  const timing = evaluateTimings(
    (await json(process.env.PERF_TIMING_FILE)) as TimingEvidence,
    uiBudgetMs,
  );
  const capacityPass = capacity.p95Ms <= baseline.p95Ms * 1.1;
  console.log(
    JSON.stringify(
      {
        timing,
        p95Ratio: capacity.p95Ms / baseline.p95Ms,
        capacityPass,
        measuredGatesPass: timing.pass && capacityPass,
        acceptance: 'PENDING_OWNER_AND_ENVIRONMENT_REVIEW',
      },
      null,
      2,
    ),
  );
  if (!timing.pass || !capacityPass) process.exitCode = 1;
}

void main().catch(() => {
  console.error(
    'Evidence evaluation failed: check schemas, successful 100/300 summaries and timing data.',
  );
  process.exitCode = 1;
});
