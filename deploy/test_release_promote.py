import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from release_promote import promote, hook as run_hook
from test_release_package import package


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = self.root / 'config'
        self.config.mkdir(mode=0o700)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.hooks = self.root / 'hooks'
        self.hooks.mkdir()
        self.release = package()
        approval = dict(self.release, target='rehearsal', approvedBy='test-owner')
        approval.update({key: True for key in ('tls', 'internalStaffAccess', 'backupVerified',
                        'monitoring', 'sessionPreservation', 'singleInstanceFencing', 'imageConfigCompatible')})
        values = {'approval.json': approval, 'schema.json': {'backwardCompatible': True, 'approval': 'DB-owner', 'revision': 'reviewed-schema'},
                  'runtime.json': {'origin': 'https://mad.example', 'apiOrigin': 'https://gateway.example'},
                  'smoke.json': {'username': 'test', 'password': 'private'}}
        for name, value in values.items():
            path = self.config / name
            path.write_text(json.dumps(value)); path.chmod(0o600)
        self.previous = dict(self.release, sourceSha='b' * 40, config=str(self.config))
        (self.state / 'current.json').write_text(json.dumps(self.previous))
        self.receipt = {key: self.release[key] for key in ('backend', 'frontend')}

    def tearDown(self):
        self.temp.cleanup()

    def execute(self, target='rehearsal', **kwargs):
        def write(path, value):
            destination = self.root / 'result.json' if path.name == 'release-result.json' else path
            destination.write_text(json.dumps(value))
        with patch('release_promote.atomic_json', side_effect=write):
            return promote(self.release, 'test/mad', target, self.config, self.state, self.hooks, **kwargs)

    @patch('release_promote.smoke_release')
    @patch('release_promote.hook')
    def test_success_promotes_the_exact_accepted_images(self, hook, smoke):
        hook.side_effect = [self.receipt, {'compatible': True}, self.receipt, {'compatible': True}]
        self.assertTrue(self.execute())
        current = json.loads((self.state / 'current.json').read_text())
        self.assertEqual(current['backend'], self.release['backend'])
        self.assertEqual(current['frontend'], self.release['frontend'])
        self.assertEqual(json.loads((self.root / 'result.json').read_text())['outcome'], 'PROMOTED')

    @patch('release_promote.smoke_release')
    @patch('release_promote.hook')
    def test_simulated_failure_restores_compatibility_within120_but_job_fails(self, hook, smoke):
        hook.side_effect = [self.receipt, {'compatible': True}, self.receipt,
                            self.receipt, {'compatible': True}]
        self.assertFalse(self.execute(simulate=True, clock=iter([0, 1, 2, 3, 4, 90]).__next__))
        result = json.loads((self.root / 'result.json').read_text())
        self.assertEqual(result['rollback'], 'RESTORED_WITHIN_BUDGET')
        self.assertTrue(result['compatibilityVerified'])
        self.assertEqual(json.loads((self.state / 'current.json').read_text()), self.previous)

    @patch('release_promote.smoke_release')
    @patch('release_promote.hook')
    def test_late_recovery_cannot_pass_the_two_minute_gate(self, hook, smoke):
        hook.side_effect = [self.receipt, {'compatible': True}, self.receipt,
                            self.receipt, {'compatible': True}]
        self.assertFalse(self.execute(simulate=True, clock=iter([0, 1, 2, 3, 4, 122]).__next__))
        self.assertEqual(json.loads((self.root / 'result.json').read_text())['rollback'], 'RESTORED_TOO_SLOW')

    @patch('release_promote.smoke_release')
    @patch('release_promote.hook')
    def test_failed_recovery_reports_operator_required(self, hook, smoke):
        hook.side_effect = [self.receipt, {'compatible': True}, self.receipt, RuntimeError('private failure')]
        self.assertFalse(self.execute(simulate=True))
        result = (self.root / 'result.json').read_text()
        self.assertIn('FAILED_OPERATOR_REQUIRED', result)
        self.assertNotIn('private failure', result)

    @patch('release_promote.hook')
    def test_unapproved_candidate_never_touches_traffic(self, hook):
        approval = self.config / 'approval.json'
        approval.write_text('{}')
        self.assertFalse(self.execute())
        hook.assert_not_called()

    @patch('release_promote.hook')
    def test_incompatible_data_blocks_switch(self, hook):
        hook.side_effect = [self.receipt, {'compatible': False}]
        self.assertFalse(self.execute())
        self.assertEqual(hook.call_count, 2)

    @patch('release_promote.hook')
    def test_production_never_accepts_simulated_failure(self, hook):
        self.assertFalse(self.execute(target='production', simulate=True))
        hook.assert_not_called()

    @patch('release_promote.subprocess.Popen')
    def test_hook_receipt_is_parsed_without_running_a_real_hook(self, popen):
        executable = self.hooks / 'prepare'
        executable.write_text('# owner-controlled fixture only\n')
        executable.chmod(0o700)
        process = popen.return_value
        process.returncode = 0
        process.communicate.return_value = (json.dumps(self.receipt).encode(), None)
        self.assertEqual(run_hook(self.hooks, 'prepare', self.state / 'candidate.json', 1), self.receipt)
        self.assertTrue(popen.call_args.kwargs['start_new_session'])

    @patch('release_promote.os.killpg')
    @patch('release_promote.subprocess.Popen')
    def test_timed_out_hook_group_is_stopped_before_recovery(self, popen, kill):
        executable = self.hooks / 'switch'
        executable.write_text('# not executed\n')
        executable.chmod(0o700)
        process = popen.return_value
        process.pid = 123
        process.communicate.side_effect = [subprocess.TimeoutExpired('fixture', 1), (b'', None)]
        with self.assertRaises(subprocess.TimeoutExpired):
            run_hook(self.hooks, 'switch', self.state / 'candidate.json', 1)
        kill.assert_called_once()


if __name__ == '__main__':
    unittest.main()
