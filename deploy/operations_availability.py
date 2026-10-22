"""Summarize retained one-minute observations; missing probes never count as uptime."""
import argparse
import calendar
from datetime import datetime, timezone
import gzip
import json
from zoneinfo import ZoneInfo


def summarize(records, month, now=None):
    year, number = map(int, month.split('-'))
    zone = ZoneInfo('Asia/Colombo')
    start = datetime(year, number, 1, tzinfo=zone)
    end = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=zone)
    now = now or datetime.now(timezone.utc)
    expected = calendar.monthrange(year, number)[1] * 1440
    elapsed = int(max(0, min((now - start).total_seconds(), (end - start).total_seconds())) // 60)
    slots = {}
    for record in records:
        try:
            if record.get('service') != 'mad-monitor' or record.get('event') not in (
                    'availability.observed', 'availability.configuration_failed'):
                continue
            timestamp = datetime.fromisoformat(record['timestamp'].replace('Z', '+00:00'))
            if timestamp.tzinfo is None:
                continue
            slot = int((timestamp - start).total_seconds() // 60)
            if slot < 0 or slot >= elapsed:
                continue
            checks = record.get('checks', {})
            healthy = record.get('outcome') == 'HEALTHY' and checks.get('frontend') is True and checks.get('gateway_backend') is True
            slots[slot] = slots.get(slot, True) and healthy
        except (ValueError, TypeError, KeyError, AttributeError):
            continue
    healthy = sum(slots.values())
    missing = elapsed - len(slots)
    closed = now >= end
    lower_bound = healthy * 100 / elapsed if elapsed else None
    return {'month': month, 'timezone': 'Asia/Colombo', 'expectedMonthMinutes': expected,
            'elapsedMinutes': elapsed, 'healthyObservedMinutes': healthy,
            'unavailableObservedMinutes': len(slots) - healthy, 'missingMinutes': missing,
            'availabilityLowerBoundPercent': lower_bound, 'monthlyTargetPercent': 99.5,
            'closedMonth': closed,
            'acceptance': 'PASS' if closed and missing == 0 and lower_bound >= 99.5
            else 'INCOMPLETE' if not closed or missing else 'TARGET_NOT_MET'}


def records(paths):
    for path in paths:
        opener = gzip.open if path.endswith('.gz') else open
        with opener(path, 'rt') as stream:
            for line in stream:
                try:
                    yield json.loads(line)
                except ValueError:
                    continue


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--month', required=True)
    parser.add_argument('files', nargs='+')
    args = parser.parse_args()
    try:
        print(json.dumps(summarize(records(args.files), args.month), indent=2))
    except Exception:
        print('Availability evidence could not be read or parsed; check month and restricted log files.')
        raise SystemExit(1)
