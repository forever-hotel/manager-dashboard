"""Approval-gated host-hook orchestration; no image build, SQL or storage deletion."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import stat
import signal
import subprocess
import sys
import time
from staging_deploy import atomic_json
from staging_smoke import origin
from release_package import validate


def private(path, directory=False):
    path = Path(path)
    if (not path.is_absolute() or path.is_symlink() or path.stat().st_mode & 0o077
            or (directory and not path.is_dir())):
        raise ValueError('Private absolute host path required')
    return path


def hook(directory, action, release_file, timeout):
    executable = directory / action
    if executable.is_symlink() or not executable.is_file() or executable.stat().st_mode & 0o022:
        raise ValueError('Owner-controlled hook required')
    if not executable.stat().st_mode & stat.S_IXUSR:
        raise ValueError('Executable hook required')
    process = subprocess.Popen([str(executable), str(release_file)],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               stdin=subprocess.DEVNULL, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        # Kill the hook's process group so a delayed switch cannot race rollback.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate(timeout=5)
        raise
    if process.returncode != 0:
        raise ValueError('Host hook failed')
    if len(output) > 65536:
        raise ValueError('Oversized hook receipt')
    return json.loads(output)


def smoke_release(release, timeout):
    subprocess.run([sys.executable, str(Path(__file__).with_name('release_smoke.py')),
                    release['config']], check=True, timeout=timeout,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def matching(receipt, release):
    return all(receipt.get(key) == release[key] for key in ('backend', 'frontend'))


def promote(package, repository, target, config, state, hooks, simulate=False, clock=time.monotonic):
    report = {'outcome': 'FAILED', 'rollback': 'NOT_REQUIRED', 'target': target,
              'stage': 'preflight', 'rollbackBudgetSeconds': 120}
    changed_at = None
    previous = None
    candidate_file = state / 'candidate.json'
    try:
        validate(package, repository, package['tag'])
        if target not in ('production', 'rehearsal') or (simulate and target != 'rehearsal'):
            raise ValueError('Simulation is rehearsal-only')
        for name in ('approval.json', 'schema.json', 'runtime.json', 'smoke.json'):
            private(config / name)
        approval = json.loads((config / 'approval.json').read_text())
        for key in ('tag', 'sourceSha', 'backend', 'frontend'):
            if approval.get(key) != package[key]:
                raise ValueError('Host approval does not match release')
        if approval.get('target') != target or not approval.get('approvedBy'):
            raise ValueError('Explicit environment approval required')
        for key in ('tls', 'internalStaffAccess', 'backupVerified', 'monitoring',
                    'sessionPreservation', 'singleInstanceFencing', 'imageConfigCompatible'):
            if approval.get(key) is not True:
                raise ValueError('Incomplete host release checklist')
        schema = json.loads((config / 'schema.json').read_text())
        if schema.get('backwardCompatible') is not True or not schema.get('approval') or not schema.get('revision'):
            raise ValueError('Compatible manual schema approval required')
        runtime = json.loads((config / 'runtime.json').read_text())
        origin(runtime['origin']); origin(runtime['apiOrigin'])
        previous = json.loads((state / 'current.json').read_text())
        validate(previous, repository, previous['tag'])
        private(Path(previous['config']), directory=True)
        candidate = dict(package, config=str(config))
        atomic_json(candidate_file, candidate)
        previous_file = state / 'recovery.json'
        atomic_json(previous_file, previous)
        report.update(tag=package['tag'], sourceSha=package['sourceSha'],
                      backend=package['backend'], frontend=package['frontend'])
        report['stage'] = 'prepare'
        if not matching(hook(hooks, 'prepare', candidate_file, 300), candidate):
            raise ValueError('Prepared image digests differ')
        if hook(hooks, 'compatibility', previous_file, 60).get('compatible') is not True:
            raise ValueError('Previous data compatibility unverified')
        report['stage'] = 'switch'
        changed_at = clock()
        if not matching(hook(hooks, 'switch', candidate_file, 60), candidate):
            raise ValueError('Active image digests differ')
        if simulate:
            # Deterministic fault after switch. Recovery must use the real hooks.
            changed_at = clock()
            raise RuntimeError('Rehearsal failure injected')
        report['stage'] = 'smoke'
        smoke_release(candidate, 60)
        if hook(hooks, 'compatibility', candidate_file, 60).get('compatible') is not True:
            raise ValueError('Candidate data compatibility unverified')
        atomic_json(state / 'previous.json', previous)
        atomic_json(state / 'current.json', candidate)
        report.update(outcome='PROMOTED', stage='complete')
        return True
    except Exception:
        if changed_at is not None and previous:
            try:
                def remaining():
                    # Still attempt recovery if already late, but never call it a pass.
                    return max(1, 120 - (clock() - changed_at))
                restored = hook(hooks, 'rollback', state / 'recovery.json', remaining())
                if not matching(restored, previous):
                    raise ValueError('Recovery image digests differ')
                smoke_release(previous, remaining())
                if hook(hooks, 'compatibility', state / 'recovery.json', remaining()).get('compatible') is not True:
                    raise ValueError('Recovery data incompatible')
                elapsed = clock() - changed_at
                atomic_json(state / 'current.json', previous)
                report.update(rollbackSeconds=round(elapsed, 3),
                              rollback='RESTORED_WITHIN_BUDGET' if elapsed <= 120 else 'RESTORED_TOO_SLOW',
                              compatibilityVerified=True)
            except Exception:
                report['rollback'] = 'FAILED_OPERATOR_REQUIRED'
        return False  # A recovered failed deployment is still failed.
    finally:
        atomic_json(Path('release-result.json').resolve(), report)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', choices=['production', 'rehearsal'], required=True)
    parser.add_argument('--simulate-failure', action='store_true')
    args = parser.parse_args()
    config = private(os.environ['MAD_RELEASE_CONFIG_DIR'], directory=True)
    state = private(os.environ['MAD_RELEASE_STATE_DIR'], directory=True)
    hooks = private(os.environ['MAD_RELEASE_HOOKS_DIR'], directory=True)
    package = json.loads(Path('deploy/release/candidate.json').read_text())
    with (state / 'release.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return 0 if promote(package, os.environ['GITHUB_REPOSITORY'], args.target,
                            config, state, hooks, args.simulate_failure) else 1


if __name__ == '__main__':
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except Exception:
        print('Release preflight failed; verify reviewed private host configuration.')
        raise SystemExit(1)
