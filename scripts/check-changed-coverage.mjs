import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export function changedLines(diff) {
  const files = new Map();
  let file;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      if (!files.has(file)) files.set(file, new Set());
    } else if (line === "+++ /dev/null") {
      file = undefined;
    } else if (file) {
      const match = /^@@ .* \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) continue;
      const start = Number(match[1]),
        length = Number(match[2] ?? 1);
      for (let n = start; n < start + length; n++) files.get(file).add(n);
    }
  }
  return files;
}

export function readCoverage(lcov, normalize) {
  const files = new Map();
  let record;
  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      const file = normalize(line.slice(3));
      record = files.get(file) ?? { lines: new Map(), branches: new Map() };
      files.set(file, record);
    } else if (record && line.startsWith("DA:")) {
      const [number, hits] = line.slice(3).split(",").map(Number);
      if (!Number.isSafeInteger(number) || !Number.isFinite(hits))
        throw new Error("Invalid line coverage");
      record.lines.set(number, (record.lines.get(number) ?? 0) + hits);
    } else if (record && line.startsWith("BRDA:")) {
      const [number, block, branch, hits] = line.slice(5).split(",");
      const count = hits === "-" ? 0 : Number(hits);
      if (!Number.isSafeInteger(Number(number)) || !Number.isFinite(count))
        throw new Error("Invalid branch coverage");
      const key = [number, block, branch].join(":");
      const prior = record.branches.get(key);
      record.branches.set(key, {
        line: Number(number),
        hits: (prior?.hits ?? 0) + count,
      });
    } else if (line === "end_of_record") record = undefined;
  }
  if (!files.size) throw new Error("LCOV contains no source records");
  return files;
}

export function assessCoverage(changes, coverage, critical = new Set()) {
  const total = { lines: 0, coveredLines: 0, branches: 0, coveredBranches: 0 };
  const failures = [];
  const entries = [];
  for (const [file, changed] of changes) {
    const record = coverage.get(file);
    if (!record) continue; // Coverage scope is controlled by Jest/Vitest configuration.
    const lines = [...record.lines].filter(([line]) => changed.has(line));
    const branches = [...record.branches.values()].filter((b) =>
      changed.has(b.line),
    );
    const coveredLines = lines.filter(([, hits]) => hits > 0).length;
    const coveredBranches = branches.filter((b) => b.hits > 0).length;
    total.lines += lines.length;
    total.coveredLines += coveredLines;
    total.branches += branches.length;
    total.coveredBranches += coveredBranches;
    entries.push({
      file,
      lines: lines.length,
      coveredLines,
      branches: branches.length,
      coveredBranches,
    });
    if (
      critical.has(file) &&
      branches.length &&
      coveredBranches / branches.length < 0.9
    )
      failures.push(`${file}: changed critical branches below 90%`);
  }
  if (total.lines && total.coveredLines / total.lines < 0.8)
    failures.push("Changed lines below 80%");
  if (total.branches && total.coveredBranches / total.branches < 0.8)
    failures.push("Changed branches below 80%");
  return { total, entries, failures };
}

function main() {
  const project = process.argv[2];
  if (!["backend", "frontend"].includes(project))
    throw new Error("Specify backend or frontend");
  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  const root = git("rev-parse", "--show-toplevel");
  const projectRoot = resolve(root, project);
  let base = process.env.COVERAGE_BASE_SHA;
  if (!base || /^0+$/.test(base)) {
    // Initial pushes have no previous tree. Compare all instrumented source.
    base = execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], {
      input: "",
      encoding: "utf8",
    }).trim();
  }
  if (!/^[a-f0-9]{40,64}$/i.test(base))
    throw new Error("COVERAGE_BASE_SHA must be a full Git object ID");
  const diff = git(
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-relative",
    "--unified=0",
    base,
    "HEAD",
    "--",
    `:(top)${project}`,
  );
  const normalize = (source) => {
    source = source.replaceAll("\\", "/");
    const absolute = isAbsolute(source)
      ? source
      : resolve(source.startsWith(project + "/") ? root : projectRoot, source);
    return relative(root, absolute).replaceAll("\\", "/");
  };
  const coverage = readCoverage(
    readFileSync(resolve(projectRoot, "coverage/lcov.info"), "utf8"),
    normalize,
  );
  const critical = new Set();
  if (project === "backend") {
    const config = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8"),
    );
    for (const [path, gate] of Object.entries(config.jest.coverageThreshold))
      if (path !== "global" && gate.branches >= 90)
        critical.add(normalize(path));
  } else {
    for (const path of coverage.keys())
      if (
        path === "frontend/lib/auth.ts" ||
        /^frontend\/app\/api\/auth\/.+\/route\.ts$/.test(path)
      )
        critical.add(path);
  }
  const result = {
    base,
    head: git("rev-parse", "HEAD"),
    project,
    ...assessCoverage(changedLines(diff), coverage, critical),
  };
  writeFileSync(
    resolve(projectRoot, "coverage/changed-coverage.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
