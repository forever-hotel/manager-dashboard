# Frontend build compromise investigation — 2026-10-13

## Findings and confidence

The build failure was caused by an executable, obfuscated downloader appended to
`frontend/postcss.config.mjs`, plus a `createRequire` import and initialization.
This is not required by PostCSS, Tailwind, or the application.

The contaminated file was already tracked and committed. At investigation start,
the working copy matched the HEAD blob after CRLF normalization. HEAD was
`0bccf49f77bf97d70861d80427e35f241b94368c` on `main`.

History identifies **merge commit
`caff31789082219b63a64647ebe42db15997941e`**, dated October 7, 2026, as the first
file-history entry containing this injection. **Both parents** (`a2e66c10` and
`3a9c35e9`) contain the clean 94-byte configuration. The older `ab72224d` version
also matches the clean configuration. The suspicious change was introduced in the
merge result; it is not inherited from either parent's version of this file.
Commit attribution identifies where the content entered history, not who or what
performed the unauthorized modification.

This establishes the immediate failure and reproduction mechanism. It does NOT
establish the original injector, the process that wrote the file, or a currently
active host persistence mechanism. No claim that npm, OneDrive, a named developer,
or an editor extension caused the injection is supported by the available evidence.

## Preserved evidence

Before editing, the exact working-copy bytes were saved as inert `.txt` evidence
under ignored `docs/security/2026-10-13-postcss/`. Do not import or execute these
files, and do not commit the payload to another executable location.

- Original size: 26,488 bytes.
- SHA-256: `f8c9e027def2e46ee13f77a36e1d22940fc444aa3135f70a7b45bf0748c5b1ed`.
- `metadata.json`: HEAD, branch, size, hash and normalized HEAD comparison.
- `file-history.txt`, `introducing-commit.txt`, `introducing-change.diff.txt`:
  history and exact introducing change.
- `decoded-string-table.txt`, `statically-substituted-payload.txt`: static-only
  interpretation aids, never executed.
- `source-review.json`: bounded application/configuration source scan results.

The decoded table was obtained by XORing literal hex bytes with 201 in Python,
then rotating the resulting table to match three independent module references.
No JavaScript evaluation, suspicious module import, remote payload retrieval or
contact with extracted endpoints was used.

## What the payload does

The visible first stage loads HTTP/HTTPS, compression, URL and child-process
facilities. It queries Ethereum RPC/indexer data for a specified sender, decodes
addresses from transaction data, retrieves encoded payloads through HTTP requests,
and decodes response bodies or an `x-payload-b64` header. Its final stage calls
`eval` and starts detached `node -e` processes with hidden windows and ignored
stdio. Errors are swallowed. A top-level `run()` makes this active module code,
not a harmless string or unused function.

The retrieved second stage is unknown. The visible first stage proves remote-code
execution intent; it does not independently prove credential theft, the second
stage's persistence behavior, or successful execution on this machine.

The supplied Turbopack trace shows configuration evaluation failing at the first
dynamic module-loading expression. That failed run does not demonstrate successful
payload download or execution. Other historical runs, direct Node imports, or a
different loader could have executed it; no historical process/network trace is
available to rule that out.

## Why the CSS build fails

`globals.css` imports Tailwind, so Next.js invokes PostCSS while processing that
stylesheet. Turbopack evaluates `postcss.config.mjs`. The appended code derives a
module name dynamically and passes it to `require`; Turbopack cannot resolve that
expression and throws. `globals.css` is the consumer that triggered configuration
loading, not the location of the injection. Disabling Turbopack would not remove
the downloader and could permit execution through another loader.

## Recurrence and scope review

- **Git:** rebuilding or checking out the contaminated committed tree restores the
  same code. A previous uncommitted cleanup does not protect other branches or
  later checkouts. The clean fix must be reviewed and merged into branches used
  for development and CI. Do not force-push or rewrite history to hide the evidence.
- **Docker:** the original Dockerfile installed dependencies, then used `COPY . .`.
  The infected host file therefore overwrote the container copy before the build.
  There are no frontend source bind mounts in the local Compose file. Normal
  image build operations cannot write this source file back to the host through
  that configuration. Cache clearing alone cannot remove committed source.
- **Dependencies:** frontend package.json and lockfile are unchanged between the
  clean merge parent and the investigation HEAD. All resolved entries in reviewed
  frontend/backend/gateway lockfiles use the npm registry and carry integrity
  fields. Frontend packages marked with installation scripts are esbuild,
  fsevents and unrs-resolver. Their existence is not evidence of malware.
  Original frontend scripts have no custom install or pre/post-build hooks.
  Arbitrary install scripts can modify writable files, but none was identified
  here as the injector. Registry URLs/integrity fields alone are not a complete
  supply-chain security assessment.
- **Other source/configuration:** the bounded scan covered 139 application,
  script and configuration files (including the locally ignored gateway).
  No additional matching first-stage payload was found in that scope. The
  quality-gate script's child-process usage runs lint/format checks on a temporary
  fixture; it does not rewrite PostCSS. Reviewed build/config files have no such
  rewrite logic. A broader installed-dependency scan was stopped after prolonged
  filesystem reads; installed dependencies, caches and generated outputs are NOT
  certified clean by this review.
- **Local automation:** Git hooks are sample files; core.hooksPath and fsmonitor
  are unset. No project/user `.npmrc`, NODE_OPTIONS or NODE_PATH overrides were
  found in the inspected environment. No repository VS Code tasks/settings file
  was present. Ignored temporary push scripts named by `.gitignore` were absent.
- **Windows:** read-only process-name inspection showed no `node.exe` at the time
  checked, which says nothing about past execution or renamed processes. Inspected
  non-Microsoft scheduled tasks had ordinary-looking product names; names alone
  are not validation of their binaries. Startup value names were inspected without
  exposing command arguments. Defender reported real-time protection enabled and
  an older detection record; no evidence links that old record to this incident.
  No task/process/extension was removed on speculation.
- **OneDrive:** no sync/version-history evidence links OneDrive to the injection.
  A host write trace or its version history is needed before assigning causation.

## Applied changes

- Restored PostCSS byte content from the independently checked clean parent:
  only the `@tailwindcss/postcss` plugin export remains. Existing Tailwind v4,
  Next.js version, Turbopack, application UI and dependency versions are retained.
- Added `frontend/scripts/verify-build-config.mjs` and a reviewed SHA-256 manifest
  for PostCSS, Next, ESLint, Vitest and Playwright configuration. It reads text,
  normalizes CRLF, compares hashes and fails closed without importing the files.
- Added a built-in Node regression test that confirms clean/CRLF content passes,
  appended executable text is rejected, and verification does not rewrite it.
- Added npm integrity-check hooks for install, build and development plus explicit
  check/test commands. Docker and CI invoke checks explicitly around installation;
  they do not depend solely on lifecycle hooks.
- Frontend Docker and CI install locked dependencies with `--ignore-scripts`, and
  verify configuration before/after installation and around the production build.
  This reduces installation-time execution; it is not a guarantee that every
  dependency is safe. [npm documents the flag and lifecycle limitations](https://docs.npmjs.com/cli/v10/commands/npm-ci/).
- `.github/workflows/ci.yml` checks the frontend/browser paths before running
  tools that could load the affected configuration.

The only confirmed contaminated source file is `frontend/postcss.config.mjs`.
The files modified for this fix are that file, `frontend/package.json`,
`frontend/Dockerfile`, `.github/workflows/ci.yml`, the three new files under
`frontend/scripts/`, and this report. Local forensic files are ignored.
The existing `frontend/.env.example` modification was present before this task
and is unrelated; it was preserved. No backend/gateway application code, database
data, environment secrets or package versions were changed for this fix.

## Verification

- Clean configuration static integrity check: passed.
- Built-in guard regression test: passed, including all five protected files.
- Host file remains clean on repeated checks during investigation.
- `docker compose build mad-frontend`: **passed**. Installation completed with
  lifecycle scripts disabled, and hashes matched before/after installation.
  Next.js 16.3.5 Turbopack compiled successfully, passed TypeScript, generated
  pages and produced the final `code-mad-frontend` image. Post-build hashes
  also matched. Log: ignored `docs/security/2026-10-13-postcss/frontend-build.log`.
- The first installation attempt stalled and was cancelled. A retry with bounded
  network timeouts and install-time audit disabled completed (479 packages in
  approximately three minutes). The existing CI `npm audit` step remains.
- Container registry connectivity diagnostic: npm returned HTTP 200 for the
  locked Next.js version. No suspicious endpoints were contacted.
- `docker compose config --quiet`: passed. `docker compose ps` found no running
  services in this project; backend/gateway runtime smoke tests were therefore
  not performed. Their code and root Compose configuration have no changes.
- `git diff --check`: passed. Dependency versions and lockfiles are unchanged.
- Direct host frontend build and application-wide test suites were not run;
  the production build was intentionally validated inside Docker without secrets.
- No real account provisioning, emails, database changes, or service startup was
  performed for this investigation. Backend/gateway runtime health is not implied
  by unchanged source code.

## Remaining host investigation and security follow-up

1. Preserve the evidence and relevant build/CI logs. Inspect PR #30's merge audit,
   actor, workflow runs, repository app permissions and local Git/reflog history
   around October 7. Establish how the merge result acquired a change absent from
   both parents. Do not assume the displayed commit author performed the injection.
2. Use [Microsoft Process Monitor](https://learn.microsoft.com/sysinternals/downloads/procmon)
   to capture file activity. Filter Path to the full PostCSS filename (and its
   directory for rename/replacement events). Inspect WriteFile, creation and
   rename events, process ID, parent process and executable signature. Observe
   normal clean checkout/editor/sync activity; never deliberately run the payload.
   Save the trace privately because process details can include sensitive values.
3. Inspect complete scheduled-task actions, HKCU/HKLM Run/RunOnce, Startup folders,
   installed services, editor extensions and their signatures. Check Defender
   Protection History and perform a full/offline scan using Windows Security.
   Investigate suspicious findings before disabling/removing anything. A clean
   scan alone does not rule out compromise.
4. Inspect OneDrive version history for the affected file and compare timestamps
   with Git/editor events. A fresh reviewed checkout outside synchronized folders
   is useful for comparison; moving the project alone does not remove host malware.
5. If this configuration may have executed successfully, treat accessible secrets
   as potentially exposed: Neon credentials, JWT signing keys/session secrets,
   initial manager credentials, SendGrid API keys, staff-delivery encryption keys,
   GitHub tokens/SSH credentials and relevant cloud/npm credentials. Rotate/revoke
   through a clean device and review account access logs. Do not publish values.
   Plan staff encryption-key rotation with pending deliveries in mind: changing
   that key blindly makes queued credentials unreadable. Invalidate affected
   sessions when rotating signing keys.
6. Share the incident and clean fix with repository maintainers through your normal
   channel. I have not contacted anyone, pushed commits or changed remote settings.

## Prevention and safe usage

Merge the fix into every active branch before rebuilding; prevent accidental
restoration of the infected historic blob. Require review of build configuration,
the integrity manifest/checker, package scripts, lockfiles and CI changes.
For an intentional configuration edit, review its entire contents and update only
its manifest hash in the same reviewed commit. Never regenerate hashes simply to
make a failing check pass.

From the repository root:

```powershell
node frontend/scripts/verify-build-config.mjs
node --test frontend/scripts/verify-build-config.test.mjs
docker compose build mad-frontend
node frontend/scripts/verify-build-config.mjs
```

For a clean, isolated direct frontend environment, run the verifier, then
`npm ci --ignore-scripts`, verify again, build, and verify again. Never copy real
`.env` secrets into an investigation container. Calling `next` directly bypasses
npm hooks; the Docker/CI explicit checks remain important.

The guard detects unexpected changes against the reviewed baseline. It does not
prevent a privileged host attacker from changing both the source and guard. Until
the initial injector and any host persistence are ruled out, a successful build
must not be described as proof of a secure machine or a permanent host cleanup.
