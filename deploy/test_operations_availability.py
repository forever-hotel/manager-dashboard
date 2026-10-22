from datetime import datetime, timezone
import unittest
from operations_availability import summarize


class AvailabilityTests(unittest.TestCase):
    def test_missing_and_duplicate_failed_observations_never_inflate_uptime(self):
        healthy = {'service': 'mad-monitor', 'event': 'availability.observed',
                   'timestamp': '2026-10-20T18:30:10Z', 'outcome': 'HEALTHY',
                   'checks': {'frontend': True, 'gateway_backend': True}}
        failed = dict(healthy, outcome='DEGRADED')
        result = summarize([healthy, failed, healthy], '2026-10', datetime(2026, 11, 1, tzinfo=timezone.utc))
        self.assertEqual(result['healthyObservedMinutes'], 0)
        self.assertEqual(result['unavailableObservedMinutes'], 1)
        self.assertGreater(result['missingMinutes'], 0)
        self.assertEqual(result['acceptance'], 'INCOMPLETE')

    def test_short_probe_run_does_not_prove_monthly_uptime(self):
        result = summarize([], '2026-10', datetime(2026, 10, 21, tzinfo=timezone.utc))
        self.assertFalse(result['closedMonth'])
        self.assertEqual(result['acceptance'], 'INCOMPLETE')
        self.assertEqual(result['expectedMonthMinutes'], 44640)

    def test_configuration_failures_and_malformed_records_are_not_healthy(self):
        records = [None, {}, {'service': 'mad-monitor', 'event': 'availability.configuration_failed',
                    'timestamp': '2026-10-20T18:30:10Z', 'outcome': 'DEGRADED'}]
        result = summarize(records, '2026-10', datetime(2026, 11, 1, tzinfo=timezone.utc))
        self.assertEqual(result['healthyObservedMinutes'], 0)
        self.assertEqual(result['unavailableObservedMinutes'], 1)


if __name__ == '__main__':
    unittest.main()
