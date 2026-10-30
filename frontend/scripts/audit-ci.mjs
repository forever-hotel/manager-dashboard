import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const advisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const expires = Date.parse('2026-11-14T00:00:00Z');
const lintChain = new Set(['braces', 'micromatch', 'fast-glob', '@next/eslint-plugin-next', 'eslint-config-next']);

// Fail closed: only the reviewed advisory in the reviewed dev-only chain is allowed.
export function evaluateAudit(report, lock, now = Date.now()) {
  if (
    report?.error ||
    !report?.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities) ||
    !lock?.packages
  ) {
    throw new Error('Missing or invalid audit/lockfile data');
  }
  const findings = report.vulnerabilities;
  function exempt(name, visited = new Set()) {
    const finding = findings[name];

    if (
      now >= expires ||
      visited.has(name) ||
      !lintChain.has(name) ||
      !finding ||
      finding.severity !== 'high' ||
      !Array.isArray(finding.nodes) ||
      !finding.nodes.length ||
      !finding.nodes.every(node => lock.packages[node]?.dev === true) ||
      !Array.isArray(finding.via) ||
      !finding.via.length
    )
      return false;
    const path = new Set([...visited, name]);

    return finding.via.every(via =>
      typeof via === 'string'
        ? exempt(via, path)
        : name === 'braces' && via?.url === advisory && via?.severity === 'high'
    );
  }
  const blocked = [];
  const allowed = [];

  for (const [name, finding] of Object.entries(findings)) {
    if (!['info', 'low', 'moderate', 'high', 'critical'].includes(finding.severity)) {
      throw new Error(`Invalid audit severity: ${name}`);
    }
    if (['high', 'critical'].includes(finding.severity)) {
      (exempt(name) ? allowed : blocked).push(name);
    }
  }
  return { blocked, allowed };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  if (!process.env.npm_execpath) throw new Error('Run through npm run audit:ci');
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, 'audit', '--package-lock-only', '--json', '--audit-level=high'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error('npm audit could not complete', { cause: result.error });
  }
  const report = JSON.parse(result.stdout);
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  const { blocked, allowed } = evaluateAudit(report, lock);

  if (allowed.length)
    console.warn(`Temporary dev-only exception (${advisory}), expires 2026-11-14: ${allowed.join(', ')}`);
  if (blocked.length)
    throw new Error(`High/critical vulnerabilities: ${blocked.join(', ')}. Run npm audit for details.`);
  console.log('Audit gate passed; no unexcepted high/critical vulnerabilities.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
