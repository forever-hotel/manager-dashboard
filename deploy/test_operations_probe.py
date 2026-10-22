import json
import unittest
from unittest.mock import MagicMock
from operations_probe import observe


class ProbeTests(unittest.TestCase):
    def test_healthy_and_unavailable_are_safe_observations(self):
        client = MagicMock()
        response = client.open.return_value.__enter__.return_value
        response.status = 200
        record = observe('https://mad.example', 'https://gateway.example', client)
        self.assertEqual(record['outcome'], 'HEALTHY')
        self.assertEqual(client.open.call_count, 2)
        client.open.side_effect = RuntimeError('private dependency password')
        record = observe('https://mad.example', 'https://gateway.example', client)
        self.assertEqual(record['outcome'], 'DEGRADED')
        self.assertNotIn('password', json.dumps(record))

    def test_non_success_response_is_not_available(self):
        client = MagicMock()
        client.open.return_value.__enter__.return_value.status = 503
        self.assertEqual(observe('https://mad.example', 'https://gateway.example', client)['outcome'], 'DEGRADED')


if __name__ == '__main__':
    unittest.main()
