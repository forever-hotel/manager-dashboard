import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBuildConfig } from './verify-build-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('./build-config-integrity.json', import.meta.url), 'utf8'));

test('reviewed configuration passes and Windows line endings are accepted', () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'mad-config-check-'));
  try {
    for (const name of Object.keys(manifest)) {
      const contents = readFileSync(resolve(root, name), 'utf8').replace(/\r\n/g, '\n');
      writeFileSync(resolve(fixture, name), contents.replace(/\n/g, '\r\n'));
    }
    assert.doesNotThrow(() => verifyBuildConfig(fixture));
    for (const name of Object.keys(manifest)) {
      const path = resolve(fixture, name);
      const original = readFileSync(path, 'utf8');
      // Text only: if imported this would throw. The verifier must never execute it.
      const injected = original + '\nthrow new Error("UNTRUSTED_CODE_EXECUTED");\n';
      writeFileSync(path, injected);
      assert.throws(() => verifyBuildConfig(fixture), /Build configuration integrity failed/);
      assert.equal(readFileSync(path, 'utf8'), injected);
      writeFileSync(path, original);
    }
  } finally {
    // Only the exact temporary directory created by this test is removed.
    rmSync(fixture, { recursive: true });
  }
});
