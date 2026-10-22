"""Read-only HTTPS monitoring observation; no response bodies or credentials logged."""
import json
import os
from datetime import datetime, timezone
from uuid import uuid4
from urllib.request import build_opener, Request, HTTPRedirectHandler
from urllib.parse import urlsplit


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
            or parsed.password or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment):
        raise ValueError('Expected HTTPS origin')
    return value.rstrip('/')


def observe(app, gateway, client=None):
    app, gateway = origin(app), origin(gateway)
    client = client or build_opener(NoRedirect())
    checks = {}
    for name, url in [('frontend', app + '/api/health'),
                      ('gateway_backend', gateway + '/mad/health/ready')]:
        try:
            with client.open(Request(url), timeout=10) as response:
                checks[name] = response.status == 200
        except Exception:
            checks[name] = False
    return {'timestamp': datetime.now(timezone.utc).isoformat(),
            'service': 'mad-monitor', 'event': 'availability.observed',
            'actorId': 'system', 'correlationId': str(uuid4()),
            'outcome': 'HEALTHY' if all(checks.values()) else 'DEGRADED',
            'checks': checks}


if __name__ == '__main__':
    try:
        record = observe(os.environ['MAD_MONITOR_APP_ORIGIN'],
                         os.environ['MAD_MONITOR_API_ORIGIN'])
    except Exception:
        record = {'timestamp': datetime.now(timezone.utc).isoformat(),
                  'service': 'mad-monitor', 'event': 'availability.configuration_failed',
                  'actorId': 'system', 'correlationId': str(uuid4()), 'outcome': 'DEGRADED'}
    print(json.dumps(record))
    raise SystemExit(0 if record['outcome'] == 'HEALTHY' else 1)
