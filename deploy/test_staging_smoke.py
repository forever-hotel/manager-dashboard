"""Smoke contract tests use in-memory HTTP doubles, never staging credentials."""
import io
import json
import unittest
from unittest.mock import MagicMock, patch
from staging_smoke import smoke


class Response(io.BytesIO):
    def __init__(self, data, status=200, content_type='application/json'):
        super().__init__(data if isinstance(data, bytes) else json.dumps(data).encode())
        self.status = status
        self.headers = {'Content-Type': content_type}


class SmokeTests(unittest.TestCase):
    def setUp(self):
        self.credentials = {'username': 'synthetic-manager', 'password': 'private-test-only'}
        self.cookie = MagicMock(name='cookie')
        self.cookie.name = 'mad_session'
        self.cookie.secure = True
        self.cookie.has_nonstandard_attr.return_value = True
        self.cookie.get_nonstandard_attr.return_value = 'Strict'
        self.client = MagicMock()
        self.responses = [
            Response({'status': 'ok'}), Response({'status': 'ok'}),
            Response(b'Manager Dashboard', content_type='text/html'),
            Response({'code': 'UNAUTHENTICATED'}, 401),
            Response({'passwordChangeRequired': False}), Response({'role': 'MANAGER'}),
            Response({'bookings': {'total': 1}}), Response({'code': 'SIGNED_OUT'}),
            Response({'code': 'UNAUTHENTICATED'}, 401),
        ]

    def execute(self):
        self.client.open.side_effect = self.responses
        with patch('staging_smoke.http.cookiejar.CookieJar', return_value=[self.cookie]), \
                patch('staging_smoke.urllib.request.build_opener', return_value=self.client):
            smoke('https://mad.example', 'https://gateway.example', self.credentials)

    def test_login_session_protected_api_logout_and_anonymous_denial(self):
        self.execute()
        self.assertEqual(self.client.open.call_count, 9)
        requests = [call.args[0] for call in self.client.open.call_args_list]
        self.assertEqual(json.loads(requests[4].data), self.credentials)
        self.assertTrue(requests[7].full_url.endswith('/logout'))

    def test_first_login_account_fails_and_still_logs_out(self):
        self.responses[4] = Response({'passwordChangeRequired': True})
        self.responses[5] = Response({'code': 'SIGNED_OUT'})
        with self.assertRaises(ValueError):
            self.execute()
        self.assertTrue(self.client.open.call_args.args[0].full_url.endswith('/logout'))

    def test_insecure_cookie_fails_and_still_logs_out(self):
        self.cookie.secure = False
        self.responses[5] = Response({'code': 'SIGNED_OUT'})
        with self.assertRaises(ValueError):
            self.execute()
        self.assertTrue(self.client.open.call_args.args[0].full_url.endswith('/logout'))

    def test_analytics_failure_still_logs_out(self):
        self.responses[6] = Response({}, 503)
        with self.assertRaises(ValueError):
            self.execute()
        self.assertTrue(self.client.open.call_args.args[0].full_url.endswith('/logout'))

    def test_invalid_authorization_response_prevents_login(self):
        self.responses[3] = Response({'code': 'unexpected'}, 401)
        with self.assertRaises(ValueError):
            self.execute()
        self.assertEqual(self.client.open.call_count, 4)


if __name__ == '__main__':
    unittest.main()
