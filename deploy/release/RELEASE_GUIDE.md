# Production promotion and rollback rehearsal - DDP-051

Prepared 2026-10-22. **Preparation implemented; production approval and real
rehearsal acceptance remain pending.** No local tests, production/staging actions,
image publication, SQL changes or traffic switches ran for this task.

## Approval and immutable release path

The new `Reviewed MAD release promotion` workflow is manually dispatched from
main only. It does not rebuild or retag images: backend/frontend GHCR digests must
exactly match a successful, accepted DDP-049 staging artifact. It verifies the
staging source SHA is an ancestor of main and the backend/frontend directories
have no difference from that staged revision. The reviewed release tag must point
to the dispatched main commit. Application-changing merge resolutions therefore
require staging again; a merge/tag alone cannot certify an older image.

The staging run must be a successful same-repository develop push of ci.yml, with
the expected SHA and run attempt; the downloaded artifact must report DEPLOYED,
complete, and both identical digests. Owner acceptance additionally needs actual
staging, security, performance, operations, UAT and rollback evidence links.
Artifact identity does not replace review of the evidence contents.

1. Close DDP-035/047/050/052 prerequisites and other release blockers with real
   evidence. None is inferred complete by this ticket. Use the isolated rehearsal
   first; actual production needs a separate release authorization.
2. Copy candidate.json.example to **candidate.json** in this directory only after
   owner acceptance. Replace every placeholder, set acceptance=ACCEPTED and add
   reviewer/evidence. This repository deliberately ships no runnable accepted
   candidate. Commit it through reviewed main PRs, without changing staged app
   inputs, then tag that main metadata commit with the package's version tag.
3. Require the final main CI run to pass before manual dispatch. The validator
   checks the main push result and staging artifact. Both branches/tags need
   protection; preserve historical artifacts/digests and verify reviewers' links.
4. Configure protected GitHub environments **release-rehearsal** and **production**,
   each with main-only deployment rules, required human reviewers and prevented
   self-review. Environment creation alone does not install required reviewers:
   an administrator must configure and verify these rules before enabling flags.
5. Provision separate trusted Linux x64 runner groups labelled
   **mad-release-rehearsal** / **mad-production**, Python3.12, Docker and the
   platform's reviewed hooks. Never assign these runners to untrusted PR jobs.
   Rehearsal uses production-like topology with isolated data/credentials/providers,
   never production connection strings or real emails/events.
6. Keep repository variables RELEASE_REHEARSAL_ENABLED and
   PRODUCTION_RELEASE_ENABLED unset/false until the respective environment is
   approved. Disabled/off-main requests fail preflight, rather than pretending
   to deploy. Workflow dispatch itself is not release authorization.

Per-environment variables point to private absolute host directories:

| Variable           | Meaning                                                           |
| ------------------ | ----------------------------------------------------------------- |
| RELEASE_CONFIG_DIR | Immutable versioned configuration and candidate-specific approval |
| RELEASE_STATE_DIR  | Retained current/previous release state and host lock             |
| RELEASE_HOOKS_DIR  | Reviewed owner-controlled executable handoff hooks                |

Directories must be mode0700, not symlinks. Runtime/approval files are0600. Use
the built-in read-only packages GITHUB_TOKEN for GHCR and actions:read for staging
evidence. Registry credentials use a job-specific temporary Docker config with
the login action's logout cleanup. Do not put runtime secrets in inputs/manifests,
GitHub summaries or accepted evidence. Environment approval and a host-local
approval must both permit the exact candidate; there is no automatic production
push trigger or production build job.

## Host approval and runtime files

Private config contains `approval.json`, `schema.json`, `runtime.json`, `smoke.json`
and platform-specific backend/frontend secret files. `approval.json` must match
candidate tag/sourceSha/backend/frontend and include:

```json
{
  "tag": "v0.3.0",
  "sourceSha": "REPLACE_WITH_ACCEPTED_STAGING_SHA",
  "backend": "REPLACE_WITH_ACCEPTED_BACKEND_DIGEST_REFERENCE",
  "frontend": "REPLACE_WITH_ACCEPTED_FRONTEND_DIGEST_REFERENCE",
  "target": "rehearsal",
  "approvedBy": "REPLACE_WITH_AUTHORIZED_REVIEW_REFERENCE",
  "tls": true,
  "internalStaffAccess": true,
  "backupVerified": true,
  "monitoring": true,
  "sessionPreservation": true,
  "singleInstanceFencing": true,
  "imageConfigCompatible": true
}
```

These booleans are owner attestations, not automatically measured infrastructure
facts. Production requires target=production and its own authorized approval.
Never copy rehearsal approval blindly. `schema.json` requires backwardCompatible
true, the installed revision and an actual approval reference. No migration runs here: DB owners manually
verify compatibility with candidate AND previous healthy application. A destructive
schema change cannot be undone safely by swapping images.

`runtime.json` contains HTTPS origin/apiOrigin; smoke.json contains a dedicated
synthetic manager username/password with first-password change completed. Reuse
the HTTPS login/session/API/logout smoke contract from DDP-049. Smoke login/logout
updates auth/session state but performs no hotel business mutations.

The baseline **state/current.json** must contain a previous accepted release
package plus `config` referencing its retained private configuration. The platform
owner must bootstrap and independently verify that known-healthy baseline before
rehearsal. Missing baseline blocks switching. Preserve its digests/config/approval
and backups; no first-production-deploy fallback invents recovery evidence.

## Platform-owned blue-green handoff contract

The repository does not supply executable proxy/database/container-control hooks
for an unknown production platform. Owners implement/review four executables in
RELEASE_HOOKS_DIR; no group/world write or symlinks are allowed. Each receives one
absolute private release-manifest filename, writes a small JSON receipt to stdout,
exits nonzero on failure and never prints secrets. Receipt output is checked but
not uploaded raw. Read image/config values from that manifest, never mutable latest.

| Hook          | Required behavior / receipt                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prepare       | Pull/cache the identical digests and validate inactive slot/config/capacity; no live traffic or worker changes. Return backend/frontend exact digest references.       |
| compatibility | Read-only owner-approved schema/data/domain checks for the passed release; return compatible=true only with matching evidence. No restore/migration/cleanup.           |
| switch        | Fence/drain the old active MAD worker/socket ownership, activate the prepared candidate and change ingress; verify actual running digests and return backend/frontend. |
| rollback      | Restore the retained healthy slot/ingress/config without image rebuild, SQL or volume deletion; verify actual digests and return backend/frontend.                     |

This is a handoff implementation requiring real platform hooks, not a claim that
blue-green switching exists already. MAD currently needs a single active instance
until shared one-use socket tickets/fan-out are implemented. Do not start two live
MAD consumers as a normal blue-green pair: prepare images/config only, then fence
before activation. Agree drain/ingress behavior and interruption budget with the
platform team. Preserve JWT issuer/keys, durable revocation/session versions and
stable cookie/TLS origin; do not reset manager credentials. Existing sockets must
reconnect/obtain fresh tickets and reconcile; they are not transferred in memory.

Current frontend code uses runtime BFF/socket configuration; NEXT_PUBLIC_API_URL
is build-time configuration validation. Owner review must ensure the exact staged
image is suitable for production and no client bundle embeds a staging-only URL.
If incompatible, fix environment-neutral behavior and stage a new image; never
rebuild an untested production variant and call it identical promotion.

## Rehearsal, two-minute gate and recovery

Dispatch the workflow from main with target=rehearsal and simulate_failure=true
only in the approved isolated environment. Preparation/compatibility happen before
the switch. The deterministic fault fires immediately after switching; the host
rollback hook must restore the exact old digests, pass HTTPS smoke and verify data
compatibility within120 seconds measured by the monotonic clock. For an unplanned
switch/smoke fault, timing conservatively starts before the switch, including
detection latency. The report distinguishes RESTORED_WITHIN_BUDGET,
RESTORED_TOO_SLOW and FAILED_OPERATOR_REQUIRED. Hook/child-process calls have
bounded deadlines; recovery is still attempted when late, but cannot pass timing.

The failed candidate always leaves the workflow failed even after good rollback.
For a deliberate drill, reviewers inspect the expected failure's artifact and
record the successful recovery criterion separately; do not turn it into a green
production deployment. Run a subsequent non-injected rehearsal for successful
promotion evidence. Verify delegated/MAD data, grants, sequences, outboxes and
session behavior against the DDP-050 isolated-recovery evidence; a compatibility
receipt alone is insufficient without the underlying owner measurements.

No automatic restore, SQL, storage deletion, gateway rebuild or image pruning is
introduced. The workflow and host lock serialize target actions. Avoid cancelling
an active switch: power loss/forced termination can interrupt recovery and require
the operator to restore the retained slot manually using the platform runbook.
Keep emergency access and the old slot available until the release is accepted.

`release-result.json` records version/source SHA/digests, target, stage, outcome,
recovery seconds and compatibility result without raw errors/credentials. Attach
the Actions run/approval/artifact, ingress timestamps, old/new active digest proof,
data comparison, test totals/coverage, session checks and reviewer/date to
[the register](release-register.csv). No real two-minute recovery was measured
by this task; staging DDP-049's slower restart routine is not used as proof.

## Release checklist and remaining acceptance

Before production approval, reviewers must verify actual evidence for:

- Accepted staging digest pair; final main CI; protected release tag/main SHA;
  security review and current exception validity; passing performance/UAT gates.
- Production secret ownership/rotation and private permissions; HTTPS/WSS/TLS
  renewal; internal staff access/network restrictions; least-privilege DB/broker.
- Reviewed manual schema revision and backward compatibility, tested backup and
  coordinated isolated restore, approved RPO/RTO, log retention and alert delivery.
- Real blue-green/fencing/session checks, rollback <=120 seconds, compatibility
  reconciliation and emergency-owner access. Resolve defects and retest.
- Required environment reviewers/self-review protection, candidate-specific host
  authorization, release notes/PR/ticket/evidence links and authorized deployment
  window. Actual production execution needs explicit release-owner approval.

Isolated Python package/orchestration tests are added to CI, but unrun locally.
Static parsing does not prove host-hook behavior or code coverage. Required
changed-code80% line/branch and critical90% branch evidence remains pending.
DDP-051 cannot be accepted until the real authorized rehearsal and checklist pass;
the supplied example deliberately cannot authorize production.
