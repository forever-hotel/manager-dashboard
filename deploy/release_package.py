"""Validate an owner-reviewed release package and its exact staging evidence."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit


def validate(package, repository, tag):
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag) or package.get('tag') != tag:
        raise ValueError('Reviewed version tag required')
    if not re.fullmatch(r'[0-9a-f]{40}', package.get('sourceSha', '')):
        raise ValueError('Full staging source SHA required')
    prefix = 'ghcr.io/' + repository.lower() + '/'
    for component in ('backend', 'frontend'):
        if not re.fullmatch(re.escape(prefix + component) + r'@sha256:[0-9a-f]{64}', package.get(component, '')):
            raise ValueError('Same-repository digest-pinned images required')
    for field in ('stagingRunId', 'stagingRunAttempt'):
        if type(package.get(field)) is not int or package[field] < 1:
            raise ValueError('Staging execution reference required')
    if package.get('acceptance') != 'ACCEPTED' or not package.get('reviewer'):
        raise ValueError('Explicit owner acceptance required')
    for obligation in ('staging', 'security', 'performance', 'operations', 'uat', 'rollback'):
        url = urlsplit(package.get('evidence', {}).get(obligation, ''))
        if url.scheme != 'https' or not url.hostname or url.username or url.password:
            raise ValueError('Acceptance evidence links required')


def staging_matches(package, result):
    return (result.get('outcome') == 'DEPLOYED'
            and result.get('stage') == 'complete'
            and result.get('sha') == package['sourceSha']
            and all(result.get(key) == package[key] for key in ('backend', 'frontend')))


def trusted_run(package, run, repository):
    return (run.get('id') == package['stagingRunId']
            and run.get('head_sha') == package['sourceSha'] and run.get('head_branch') == 'develop'
            and run.get('event') == 'push' and run.get('conclusion') == 'success'
            and run.get('path') == '.github/workflows/ci.yml'
            and run.get('run_attempt') == package['stagingRunAttempt']
            and run.get('repository', {}).get('full_name', '').lower() == repository.lower())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--staging-result')
    parser.add_argument('--run-metadata')
    parser.add_argument('--main-ci')
    args = parser.parse_args()
    package = json.loads(Path('deploy/release/candidate.json').read_text())
    validate(package, args.repository, args.tag)
    if args.staging_result:
        if not args.run_metadata or not trusted_run(package, json.loads(Path(args.run_metadata).read_text()), args.repository):
            raise ValueError('Untrusted staging run')
        if not staging_matches(package, json.loads(Path(args.staging_result).read_text())):
            raise ValueError('Staging artifact does not match accepted release')
        return
    # Main may include release metadata, but application/build inputs must match.
    subprocess.run(['git', 'merge-base', '--is-ancestor', package['sourceSha'], 'HEAD'], check=True)
    subprocess.run(['git', 'diff', '--quiet', package['sourceSha'], 'HEAD', '--', 'backend', 'frontend'], check=True)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    runs = json.loads(Path(args.main_ci).read_text())['workflow_runs']
    if not any(run.get('head_sha') == head and run.get('conclusion') == 'success'
               and run.get('event') == 'push' and run.get('head_branch') == 'main'
               for run in runs):
        raise ValueError('Passing final main CI required')
    tagged = subprocess.check_output(['git', 'rev-parse', 'refs/tags/' + args.tag + '^{commit}'], text=True).strip()
    if head != tagged:
        raise ValueError('Tag must identify reviewed main revision')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f"run_id={package['stagingRunId']}\n")
        output.write(f"artifact=staging-deployment-{package['sourceSha']}-{package['stagingRunAttempt']}\n")


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Release package validation failed; review tag, immutable images and acceptance evidence.')
        raise SystemExit(1)
