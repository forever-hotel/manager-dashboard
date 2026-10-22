import unittest
from release_package import validate, staging_matches, trusted_run


def package():
    return {'tag': 'v0.3.0', 'sourceSha': 'a' * 40,
            'backend': 'ghcr.io/test/mad/backend@sha256:' + '1' * 64,
            'frontend': 'ghcr.io/test/mad/frontend@sha256:' + '2' * 64,
            'stagingRunId': 123, 'stagingRunAttempt': 1,
            'acceptance': 'ACCEPTED', 'reviewer': 'test-owner',
            'evidence': {key: 'https://evidence.example/review' for key in
                         ('staging', 'security', 'performance', 'operations', 'uat', 'rollback')}}


class PackageTests(unittest.TestCase):
    def test_exact_digests_and_owner_acceptance(self):
        release = package()
        validate(release, 'test/mad', 'v0.3.0')
        for patch in ({'acceptance': 'PENDING'}, {'reviewer': ''},
                      {'sourceSha': 'short'}, {'stagingRunId': True},
                      {'backend': 'ghcr.io/test/mad/backend:latest'},
                      {'frontend': 'ghcr.io/other/project/frontend@sha256:' + '2' * 64}):
            with self.assertRaises(ValueError):
                validate(dict(release, **patch), 'test/mad', 'v0.3.0')
        with self.assertRaises(ValueError):
            validate(release, 'test/mad', '../bad-tag')

    def test_artifact_must_show_the_same_successful_images(self):
        release = package()
        result = dict(outcome='DEPLOYED', stage='complete', sha=release['sourceSha'],
                      backend=release['backend'], frontend=release['frontend'])
        self.assertTrue(staging_matches(release, result))
        for patch in ({'outcome': 'FAILED'}, {'stage': 'smoke'}, {'sha': 'b' * 40},
                      {'backend': release['frontend']}):
            self.assertFalse(staging_matches(release, dict(result, **patch)))

    def test_run_identity_requires_a_successful_same_repository_develop_push(self):
        release = package()
        run = dict(id=123, head_sha=release['sourceSha'], head_branch='develop', event='push',
                   conclusion='success', path='.github/workflows/ci.yml', run_attempt=1,
                   repository={'full_name': 'test/mad'})
        self.assertTrue(trusted_run(release, run, 'test/mad'))
        for patch in ({'event': 'pull_request'}, {'conclusion': 'failure'},
                      {'head_branch': 'main'}, {'run_attempt': 2},
                      {'repository': {'full_name': 'other/mad'}}):
            self.assertFalse(trusted_run(release, dict(run, **patch), 'test/mad'))


if __name__ == '__main__':
    unittest.main()
