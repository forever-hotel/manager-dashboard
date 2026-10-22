# Staging delivery - DDP-049

Prepared 2026-10-21. Implementation is present; **acceptance is NOT_RUN** until
infrastructure is provisioned and a real deploy/recovery drill is recorded. No
tests, image publication, deployment or SQL were executed locally for this task.
This adds delivery automation, not a dashboard UI or authentication change.

## Delivery contract

`.github/workflows/ci.yml` keeps checks on pushes and PRs. Only a **push to
develop**, after backend, frontend, browser, container and deployment-tool checks
all succeed, publishes the candidate and can deploy. Protect develop against
direct pushes and require reviewed PRs/checks; the workflow cannot enforce that
repository setting itself. Main/PR/fork runs cannot publish or deploy through
these jobs. No pull_request_target or privileged workflow_run handoff is used.

This implements the ticket/Guide develop-to-staging trigger. Any SDS/general
main-release pipeline is a separate production concern: a main push does not
deploy staging here. No production job, automatic database migration or gateway
deployment is introduced. Infrastructure owns the shared gateway, broker, TLS
proxy and hosted database independently.

GHCR repositories are `ghcr.io/<lowercase-owner>/<repository>/backend` and
`.../frontend`. Images have the full 40-character commit tag and OCI revision
label; deployment uses the returned SHA256 digests, never mutable latest. The
frontend public API URL is environment-specific build configuration, not a secret.
Publication rebuilds the checked source; image readiness and deployed smoke are
checked before recording a healthy release.

The staging job uses the protected GitHub environment `staging`, a dedicated
`[self-hosted, linux, x64, mad-staging]` runner, serialized non-cancelling deploys
and a host file lock. A branch-head check rejects superseded candidates before
deployment. A commit arriving after that check may briefly follow the checked
candidate; the newer passing candidate is serialized afterwards. It never deploys
an arbitrary PR revision. The runner must not also execute untrusted PR jobs.

## One-time infrastructure setup

1. Protect develop with required checks and at least one peer approval. Create the
   `staging` environment with develop-only deployment branch rules. Add required
   environment reviewers if the team wants an approval gate; without reviewers,
   successful develop pushes deploy automatically once infrastructure is ready.
   Restrict runner-group access to this repository/trusted deployment workflows.
2. Provision a dedicated Linux x64 host, Python 3.12, Git, Docker Engine and Docker
   Compose v2 supporting `up --wait`. Register the self-hosted runner with label
   `mad-staging`; the runner user needs Docker permission (effectively host-admin
   authority). Do not share this host with developer workstations/production.
3. Create Docker network `mad-staging` and attach the independently managed
   gateway. Arrange TLS frontend proxy -> localhost:3000 and backend/gateway routes
   -> MAD at localhost:4000 or container DNS `mad-backend:4000`. Route the existing
   `/mad/socket.io` websocket path separately; the REST gateway alone does not
   provide websocket forwarding. Publish no plain database/broker ports here.
4. Provision staging Neon and RabbitMQ, restricted service roles and already-
   reviewed manual schema supplements. Preserve the single-MAD-instance transport
   constraint until shared tickets/fan-out exist. No storage service or volume is
   created/deleted by `compose.staging.yml`.
5. Provision `/opt/mad/staging/state` writable by the runner, mode0700. Provision
   versioned config directories such as `/opt/mad/staging/config/v1`, mode0700,
   containing the four files below, each0600. The tool rejects group/world-readable
   files and symlinks. Do not place these files in a checkout or artifact store.
   Retain old directories unchanged so rollback restores the old configuration
   reference as well as the old images. Secret rotation must remain compatible
   with retained releases or be handled as a separate reviewed operation.
6. Give this repository's GITHUB_TOKEN permission to write/read its GHCR packages
   and enable package access inheritance. Publication has packages:write only on
   the hosted publish job; deployment uses packages:read. Registry authentication
   uses a job-specific temporary Docker config and docker/login-action's logout
   cleanup. No personal access token is required by this workflow.

Set repository variables (non-secret):

| Variable                  | Example / meaning                                                         |
| ------------------------- | ------------------------------------------------------------------------- |
| STAGING_PUBLIC_API_ORIGIN | `https://gateway.staging.example` (publish-time and smoke gateway origin) |
| STAGING_APP_ORIGIN        | `https://mad.staging.example` (TLS frontend origin)                       |
| STAGING_CONFIG_DIR        | `/opt/mad/staging/config/v1`                                              |
| STAGING_STATE_DIR         | `/opt/mad/staging/state`                                                  |

These must be real origins with no path/query/userinfo. Do not override public
API origin differently in the environment: build-time and deployment values must
match. Missing settings fail publication or host preflight rather than falling
back to development/production credentials. The runner will wait unassigned until
the required labels exist; that is not a successful deployment.

## Host-private files

`backend.env`: use the application's reviewed backend example as the complete
configuration reference. Set the staging database connection/TLS, dedicated JWT
secret/issuer, broker URL, real-time feature flags, staff encryption/email settings
as applicable. Set `DB_SSL=true` for Neon. Compose forces NODE_ENV=production,
DB_SYNCHRONIZE=false, DB_LOGGING=false, PORT=4000 and the HTTPS frontend origin.
Bootstrap the manager manually using the established account procedure; do not
rotate initial passwords on deployment or use the smoke account as bootstrap.

`frontend.env`: for example, with a gateway container on the same network:

```dotenv
BACKEND_API_URL=http://api-gateway:8080
BACKEND_API_MODE=gateway
MAD_SOCKET_PUBLIC_URL=https://mad.staging.example
```

Use the actual independent gateway's network alias. Runtime APP_ORIGIN and port
are supplied by Compose. A different direct mode must be explicitly reviewed;
do not silently bypass the gateway when it fails.

`smoke.json`: a dedicated synthetic MANAGER account with its first password
change already completed:

```json
{
  "username": "staging-smoke-manager",
  "password": "replace-with-private-value"
}
```

Never reuse production credentials. Login can update authentication counters and
logout persists session revocation; the smoke is not a zero-write database probe.
It does not provision accounts, change passwords or write hotel business data.

`schema.json`: database-owner approval for the installed manual revision and its
compatibility with the current candidate AND retained recovery images:

```json
{
  "revision": "reviewed-manual-schema-id",
  "backwardCompatible": true,
  "approval": "DB-owner review/evidence reference"
}
```

This is an explicit owner attestation, not automatic schema introspection or
proof of migration success. Update it only after manual schema review/application.
The application readiness and API smoke additionally check actual access. Keep
destructive/incompatible schema changes outside automatic delivery; a database
restore is a separate authorized operation, never an automatic rollback action.

## Execution, evidence and failure recovery

On a passing develop push, the tool validates configuration, copies the Compose
manifest to `state/releases/<sha>/compose.yml`, pulls pinned images, waits for
both services, then checks public gateway readiness, frontend readiness/login
HTML, anonymous API401, BFF login, Secure/HttpOnly/SameSite=Strict cookie, session,
authenticated analytics, logout and anonymous API401 again. HTTPS redirects fail
instead of forwarding credentials. Logout is attempted even if authenticated
smoke fails. A failed login is not automatically retried, to avoid account lockout.

Only after success is `state/current.json` atomically updated; the last healthy
manifest becomes `previous.json`. These contain image digests, commit, config path
and public origins, never runtime secrets. Keep these state files, archived
manifests, old private config versions and registry digests for recovery. Do not
prune the current/previous images or package versions.

On schema/config/pull preflight failure, the old application is untouched. On
readiness/smoke failure after applying containers, the tool restores previous
images/config/Compose manifest and rechecks readiness plus smoke. **The job stays
failed even after successful recovery.** First-deployment failure stops only the
new MAD application containers because no healthy predecessor exists. Recovery
never invokes down, volume deletion, database drop, SQL downgrade or Docker prune.

If recovery fails, outcome is FAILED_OPERATOR_REQUIRED: inspect host health,
private configuration and the independently managed DB/gateway/broker. No raw
Compose config, container logs or HTTP bodies are uploaded automatically because
they could expose secrets. Retrieve redacted diagnostics through authorized host
operations; do not print `.env` or Docker inspect environment fields into Actions.
Avoid manually cancelling an applying deployment. Host termination, power loss or
an Actions hard kill can interrupt rollback before a report is written; operators
must compare running digests with current.json and recover using the retained
manifest. The host lock is released by the OS when the process exits.

For a manual rollback to retained `previous.json`, use the trusted deployment
code checkout on the same Linux host with the state variable set:

```bash
export MAD_STAGING_STATE_DIR=/opt/mad/staging/state
python3 - <<'PY'
import json, os, pathlib, subprocess
state = pathlib.Path(os.environ['MAD_STAGING_STATE_DIR'])
release = json.loads((state / 'previous.json').read_text())
os.environ.update(MAD_STAGING_CONFIG_DIR=release['config'],
                  MAD_STAGING_ORIGIN=release['origin'],
                  MAD_STAGING_API_ORIGIN=release['api_origin'])
subprocess.run(['python3', 'deploy/staging_deploy.py', '--sha', release['sha'],
                '--backend', release['backend'], '--frontend', release['frontend']], check=True)
PY
```

Ensure registry pull authentication is available privately on the host if images
are not cached. This reuses the same lock/readiness/smoke path and records the
result. Failed deployments leave current.json pointing at the last recorded
healthy release; consult it rather than rolling further back unnecessarily.

`deployment-result.json` and the Actions summary record SHA, digests, stage,
outcome and rollback result. Pre-tool failure has no report and is explicitly
shown in the job summary. Attach run/job/artifact URLs, schema review, actual
HTTPS staging smoke, recovery drill, peer approval and defects to
[the acceptance register](staging-register.csv). Release records must not contain
tokens/passwords. Current implementation preserves data but does not prove a
real rollback until the drill runs.

## Tests and outstanding acceptance

The new hosted deployment-tool job runs isolated Python unittest doubles for
success, schema/pull/readiness/smoke failure, rollback failure, first-deploy cleanup,
private config, cookie flags and logout cleanup. It never reaches Docker, Neon or
staging. No tests ran locally. Tool coverage measurements and required 80%
line/branch and critical90% branch evidence remain pending alongside CI; source
presence is not measured coverage. No API implementation changed.

Infrastructure/QA must execute a good deploy and controlled failed readiness/smoke
deploy, verify previous SHA/config is restored and data retained, verify manual
schema preflight failure leaves the running release untouched, and inspect all
artifacts for secrets. A failed manually applied migration is owned by the DB
owner: do not start deployment or set backwardCompatible=true; preserve the prior
application and resolve the migration separately. There is deliberately no
automatic migration phase, consistent with the project's hosted-Neon policy.

DDP-049 is accepted only after those cases pass on the configured real staging
host with passing CI/coverage, reviewed environment protections and peer approval.
