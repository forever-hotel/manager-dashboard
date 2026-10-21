import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changedLines,
  readCoverage,
  assessCoverage,
} from "./check-changed-coverage.mjs";

test("diff ranges identify added/modified lines and ignore deleted-only hunks", () => {
  const diff =
    "+++ b/backend/src/a.ts\n@@ -1,2 +1,3 @@\n@@ -9 +10 @@\n@@ -15 +15,0 @@\n+++ /dev/null";
  assert.deepEqual(
    [...changedLines(diff).get("backend/src/a.ts")],
    [1, 2, 3, 10],
  );
});
test("changed coverage fails uncovered lines and branches, including LCOV dash", () => {
  const coverage = readCoverage(
    "SF:a.ts\nDA:1,1\nDA:2,0\nBRDA:1,0,0,1\nBRDA:1,0,1,-\nend_of_record",
    (p) => p,
  );
  const result = assessCoverage(
    new Map([["a.ts", new Set([1, 2])]]),
    coverage,
    new Set(["a.ts"]),
  );
  assert.equal(result.failures.length, 3);
  assert.deepEqual(result.total, {
    lines: 2,
    coveredLines: 1,
    branches: 2,
    coveredBranches: 1,
  });
});
test("unchanged uncovered code and non-executable changes do not inflate changed coverage", () => {
  const coverage = readCoverage(
    "SF:a.ts\nDA:1,1\nDA:2,0\nend_of_record",
    (p) => p,
  );
  const result = assessCoverage(new Map([["a.ts", new Set([1, 3])]]), coverage);
  assert.equal(result.total.lines, 1);
  assert.deepEqual(result.failures, []);
});
test("duplicate LCOV records merge hits without double-counting branches", () => {
  const coverage = readCoverage(
    "SF:a.ts\nDA:1,0\nBRDA:1,0,0,-\nend_of_record\nSF:a.ts\nDA:1,1\nBRDA:1,0,0,1\nend_of_record",
    (p) => p,
  );
  assert.deepEqual(
    assessCoverage(new Map([["a.ts", new Set([1])]]), coverage).total,
    { lines: 1, coveredLines: 1, branches: 1, coveredBranches: 1 },
  );
});
test("missing or malformed coverage cannot be accepted as zero work", () => {
  assert.throws(() => readCoverage("", (p) => p));
  assert.throws(() => readCoverage("SF:a.ts\nDA:bad,no", (p) => p));
});
