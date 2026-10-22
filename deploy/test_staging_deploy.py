"""Isolated CI tests: no Docker, network or database operations."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from staging_deploy import atomic_json, deploy, validate_release
from staging_smoke import origin


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = self.root / 'config'
        self.config.mkdir(mode=0o700)
        for name in ('backend.env', 'frontend.env', 'smoke.json'):
            path = self.config / name
            path.write_text('{}')
            path.chmod(0o600)
        schema = self.config / 'schema.json'
        schema.write_text(json.dumps({'backwardCompatible': True,
                                     'revision': 'test-schema', 'approval': 'test-owner'}))
        schema.chmod(0o600)
        self.release = dict(sha='a' * 40, backend='ghcr.io/test/mad/backend@sha256:' + '1' * 64,
                            frontend='ghcr.io/test/mad/frontend@sha256:' + '2' * 64,
                            config=str(self.config), origin='https://mad.example',
                            api_origin='https://gateway.example')
        self.manifest = self.root / 'compose.yml'
        self.manifest.write_text('services: {}\n')
        self.report = self.root / 'report.json'

    def tearDown(self):
        self.temporary.cleanup()

    def previous(self):
        previous = dict(self.release, sha='b' * 40)
        atomic_json(self.root / 'current.json', previous)
        directory = self.root / 'releases' / previous['sha']
        directory.mkdir(parents=True)
        (directory / 'compose.yml').write_text('services: {}\n')
        return previous

    def test_rejects_mutable_image_and_unapproved_schema(self):
        with self.assertRaises(ValueError):
            validate_release(dict(self.release, backend='ghcr.io/test/mad:latest'))
        (self.config / 'schema.json').write_text('{"backwardCompatible": false}')
        with self.assertRaises(ValueError):
            validate_release(self.release)

    def test_requires_private_configuration(self):
        (self.config / 'smoke.json').chmod(0o644)
        with self.assertRaises(ValueError):
            validate_release(self.release)

    def test_https_origins_only(self):
        self.assertEqual(origin('https://mad.example/'), 'https://mad.example')
        for value in ('http://mad.example', 'https://user:secret@mad.example',
                      'https://mad.example/path', 'https://mad.example?token=secret'):
            with self.assertRaises(ValueError):
                origin(value)

    @patch('staging_deploy.check_smoke')
    @patch('staging_deploy.compose')
    def test_success_records_immutable_current_and_previous(self, command, smoke):
        previous = self.previous()
        self.assertTrue(deploy(self.release, self.root, self.manifest, self.report))
        self.assertEqual(json.loads((self.root / 'current.json').read_text()), self.release)
        self.assertEqual(json.loads((self.root / 'previous.json').read_text()), previous)
        smoke.assert_called_once_with(self.release)
        self.assertEqual(json.loads(self.report.read_text())['outcome'], 'DEPLOYED')

    @patch('staging_deploy.check_smoke')
    @patch('staging_deploy.compose')
    def test_failed_smoke_restores_previous_but_fails_job(self, command, smoke):
        previous = self.previous()
        smoke.side_effect = [RuntimeError('secret should not appear'), None]
        self.assertFalse(deploy(self.release, self.root, self.manifest, self.report))
        self.assertEqual(json.loads((self.root / 'current.json').read_text()), previous)
        self.assertEqual(json.loads(self.report.read_text())['rollback'], 'RESTORED_PREVIOUS_HEALTHY')
        self.assertNotIn('secret should not appear', self.report.read_text())
        self.assertFalse(any('down' in call.args or '--volumes' in call.args for call in command.call_args_list))

    @patch('staging_deploy.check_smoke')
    @patch('staging_deploy.compose')
    def test_readiness_failure_restores_previous(self, command, smoke):
        self.previous()
        command.side_effect = [None, None, RuntimeError('readiness'), None]
        self.assertFalse(deploy(self.release, self.root, self.manifest, self.report))
        self.assertEqual(json.loads(self.report.read_text())['stage'], 'readiness')
        self.assertEqual(json.loads(self.report.read_text())['rollback'], 'RESTORED_PREVIOUS_HEALTHY')

    @patch('staging_deploy.check_smoke')
    @patch('staging_deploy.compose')
    def test_failed_recovery_requires_operator(self, command, smoke):
        self.previous()
        smoke.side_effect = RuntimeError('unavailable')
        self.assertFalse(deploy(self.release, self.root, self.manifest, self.report))
        self.assertEqual(json.loads(self.report.read_text())['rollback'], 'FAILED_OPERATOR_REQUIRED')

    @patch('staging_deploy.check_smoke', side_effect=RuntimeError('smoke'))
    @patch('staging_deploy.compose')
    def test_first_failure_stops_only_application(self, command, smoke):
        self.assertFalse(deploy(self.release, self.root, self.manifest, self.report))
        self.assertEqual(command.call_args.args[-1], 'stop')
        self.assertFalse((self.root / 'current.json').exists())

    @patch('staging_deploy.compose')
    def test_schema_failure_never_touches_existing_application(self, command):
        previous = self.previous()
        (self.config / 'schema.json').write_text('{"backwardCompatible": false}')
        self.assertFalse(deploy(self.release, self.root, self.manifest, self.report))
        command.assert_not_called()
        self.assertEqual(json.loads((self.root / 'current.json').read_text()), previous)

    @patch('staging_deploy.compose', side_effect=RuntimeError('pull'))
    def test_pull_failure_does_not_attempt_rollback(self, command):
        self.previous()
        self.assertFalse(deploy(self.release, self.root, self.manifest, self.report))
        self.assertEqual(json.loads(self.report.read_text())['rollback'], 'NOT_REQUIRED')


if __name__ == '__main__':
    unittest.main()
