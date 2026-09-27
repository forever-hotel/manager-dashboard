import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const backend = existsSync('src/main.ts');
const fixture = backend ? 'src/quality-gate.fixture.ts' : 'quality-gate.fixture.ts';
if (existsSync(fixture)) throw new Error('Refusing to overwrite an existing fixture');
function failsWithoutWriting(command, content) {
  writeFileSync(fixture, content);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', command], { shell: process.platform === 'win32', encoding: 'utf8' });
  if (result.error || result.status === null) throw new Error('Quality check could not execute');
  if (result.status === 0) throw new Error(command + ' incorrectly accepted an invalid fixture');
  if (readFileSync(fixture, 'utf8') !== content) throw new Error(command + ' rewrote source files');
}
try {
  failsWithoutWriting('lint', 'export const invalid = ;\n');
  failsWithoutWriting('format:check', 'export const badlyFormatted={a:1,b:2}\n');
  console.log('Lint and formatting reject invalid fixtures without modifying them.');
} finally { if (existsSync(fixture)) unlinkSync(fixture); }
