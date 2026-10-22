"""Opt-in staging deployment; immutable images, private config, data-safe rollback."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from staging_smoke import origin, smoke


def read_json(path):
    return json.loads(Path(path).read_text())


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def validate_release(release):
    if not re.fullmatch(r'[0-9a-f]{40}', release['sha']):
        raise ValueError('Invalid commit SHA')
    for key in ('backend', 'frontend'):
        if not re.fullmatch(r'ghcr\.io/[a-z0-9_./-]+@sha256:[0-9a-f]{64}', release[key]):
            raise ValueError('Digest-pinned GHCR image required')
    for key in ('origin', 'api_origin'):
        origin(release[key])
    config = Path(release['config'])
    if not config.is_absolute() or not config.is_dir():
        raise ValueError('Private configuration directory required')
    for path in (config, *(config / name for name in (
            'backend.env', 'frontend.env', 'smoke.json', 'schema.json'))):
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise ValueError('Private configuration must not be shared or symlinked')
    approval = read_json(config / 'schema.json')
    if (approval.get('backwardCompatible') is not True
            or not approval.get('revision') or not approval.get('approval')):
        raise ValueError('Manual backward-compatible schema approval required')


def compose(release, manifest, *args):
    env = dict(os.environ, MAD_BACKEND_IMAGE=release['backend'],
               MAD_FRONTEND_IMAGE=release['frontend'],
               MAD_STAGING_CONFIG_DIR=release['config'],
               MAD_STAGING_ORIGIN=release['origin'])
    # Explicit empty interpolation file prevents loading an unrelated root .env.
    subprocess.run([
        'docker', 'compose', '--env-file', '/dev/null', '-p', 'mad-staging',
        '-f', str(manifest), *args,
    ], env=env, check=True, timeout=420, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL)


def check_smoke(release):
    smoke(release['origin'], release['api_origin'],
          read_json(Path(release['config']) / 'smoke.json'))


def deploy(candidate, state, source_manifest, report_path):
    report = {'outcome': 'FAILED',
              'rollback': 'NOT_REQUIRED', 'stage': 'preflight',
              'time': datetime.now(timezone.utc).isoformat()}
    previous = None
    touched = False
    try:
        validate_release(candidate)
        report.update(sha=candidate['sha'], backend=candidate['backend'],
                      frontend=candidate['frontend'])
        current = state / 'current.json'
        if current.exists():
            previous = read_json(current)
            validate_release(previous)
        destination = state / 'releases' / candidate['sha']
        destination.mkdir(parents=True, exist_ok=True)
        manifest = destination / 'compose.yml'
        # The same SHA may be retried, but never replace its recovery manifest.
        if manifest.exists():
            if manifest.read_bytes() != source_manifest.read_bytes():
                raise ValueError('Release manifest changed')
        else:
            shutil.copyfile(source_manifest, manifest)
        report['stage'] = 'pull'
        compose(candidate, manifest, 'config', '--quiet')
        compose(candidate, manifest, 'pull')
        report['stage'] = 'readiness'
        touched = True
        compose(candidate, manifest, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '240')
        report['stage'] = 'smoke'
        check_smoke(candidate)
        report['stage'] = 'record'
        if previous:
            atomic_json(state / 'previous.json', previous)
        atomic_json(current, candidate)
        report['outcome'] = 'DEPLOYED'
        report['stage'] = 'complete'
        return True
    except Exception:
        # Never persist raw Docker/HTTP exceptions: they can contain credentials.
        if touched:
            try:
                if previous:
                    old_manifest = state / 'releases' / previous['sha'] / 'compose.yml'
                    compose(previous, old_manifest, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '240')
                    check_smoke(previous)
                    atomic_json(state / 'current.json', previous)
                    report['rollback'] = 'RESTORED_PREVIOUS_HEALTHY'
                else:
                    compose(candidate, manifest, 'stop')
                    report['rollback'] = 'FIRST_DEPLOY_STOPPED_NO_PREVIOUS_RELEASE'
            except Exception:
                report['rollback'] = 'FAILED_OPERATOR_REQUIRED'
        return False
    finally:
        atomic_json(report_path, report)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sha', required=True)
    parser.add_argument('--backend', required=True)
    parser.add_argument('--frontend', required=True)
    args = parser.parse_args()
    state = Path(os.environ['MAD_STAGING_STATE_DIR'])
    if not state.is_absolute() or not state.is_dir() or state.is_symlink():
        raise ValueError('Provision a dedicated absolute state directory')
    state.chmod(0o700)
    candidate = dict(sha=args.sha, backend=args.backend, frontend=args.frontend,
                     config=os.environ['MAD_STAGING_CONFIG_DIR'],
                     origin=os.environ['MAD_STAGING_ORIGIN'],
                     api_origin=os.environ['MAD_STAGING_API_ORIGIN'])
    report = Path('deployment-result.json').resolve()
    # Host lock also serializes manual recovery with the workflow.
    with (state / 'deployment.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        successful = deploy(candidate, state, Path(__file__).with_name('compose.staging.yml'), report)
    print('Staging deployment succeeded.' if successful else
          'Staging deployment failed; inspect sanitized deployment-result.json.')
    return 0 if successful else 1


if __name__ == '__main__':
    os.umask(0o077)
    try:
        sys.exit(main())
    except Exception:
        print('Staging preflight failed; verify private host configuration and state permissions.')
        sys.exit(1)
