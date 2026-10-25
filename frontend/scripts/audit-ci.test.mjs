import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAudit } from './audit-ci.mjs';

const now = Date.parse('2026-10-15T00:00:00Z');
function fixture() {
  return {
    report: {
      vulnerabilities: {
        braces: {
          severity: 'high',
          nodes: ['node_modules/braces'],
          via: [
            {
              url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
              severity: 'high'
            }
          ]
        },
        micromatch: {
          severity: 'high',
          nodes: ['node_modules/micromatch'],
          via: ['braces']
        }
      }
    },
    lock: {
      packages: {
        'node_modules/braces': { dev: true },
        'node_modules/micromatch': { dev: true }
      }
    }
  };
}
test('permits only the known dev-only advisory chain before expiry', () => {
  const { report, lock } = fixture();
  assert.deepEqual(evaluateAudit(report, lock, now), {
    blocked: [],
    allowed: ['braces', 'micromatch']
  });
});
test('blocks the same advisory if any affected dependency is production', () => {
  const { report, lock } = fixture();
  delete lock.packages['node_modules/braces'].dev;
  assert.deepEqual(evaluateAudit(report, lock, now).blocked, ['braces', 'micromatch']);
});
test('blocks additional advisories even in an otherwise excepted package', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.braces.via.push({
    url: 'https://github.com/advisories/new',
    severity: 'critical'
  });
  assert.deepEqual(evaluateAudit(report, lock, now).blocked, ['braces', 'micromatch']);
});
test('expires automatically and rejects missing dependency-chain information', () => {
  const { report, lock } = fixture();
  assert.equal(evaluateAudit(report, lock, Date.parse('2026-11-14')).blocked.length, 2);
  report.vulnerabilities.micromatch.via = ['unknown'];
  assert.deepEqual(evaluateAudit(report, lock, now).blocked, ['micromatch']);
});
test('fails closed on audit service errors or malformed reports', () => {
  const { report, lock } = fixture();
  assert.throws(() => evaluateAudit({ error: { message: 'offline' } }, lock, now));
  assert.throws(() => evaluateAudit({}, lock, now));
  report.vulnerabilities.braces.severity = 'invalid';
  assert.throws(() => evaluateAudit(report, lock, now));
});
