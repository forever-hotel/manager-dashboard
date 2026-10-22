"""HTTPS staging smoke. No SQL, password changes or credential output."""
import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def origin(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
            or parsed.password or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment):
        raise ValueError('Expected HTTPS origin')
    return value.rstrip('/')


def smoke(app_origin, api_origin, credentials):
    app_origin, api_origin = origin(app_origin), origin(api_origin)
    jar = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(
        NoRedirect(), urllib.request.HTTPCookieProcessor(jar))

    def call(url, expected=200, body=None, json_body=True):
        headers = {'Origin': app_origin, 'Content-Type': 'application/json'}
        request = urllib.request.Request(
            url, headers=headers,
            data=None if body is None else json.dumps(body).encode())
        try:
            response = client.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if response.status != expected:
                raise ValueError('Smoke response failed')
            data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('Oversized smoke response')
            if json_body:
                if 'application/json' not in response.headers.get('Content-Type', ''):
                    raise ValueError('Non-JSON smoke response')
                return json.loads(data)
            return data

    call(api_origin + '/mad/health/ready')
    call(app_origin + '/api/health')
    if b'Manager Dashboard' not in call(app_origin + '/login', json_body=False):
        raise ValueError('Login page failed')
    denied = call(app_origin + '/api/analytics?period=day', expected=401)
    if denied.get('code') != 'UNAUTHENTICATED':
        raise ValueError('Unexpected authorization envelope')
    logged_in = False
    try:
        session = call(app_origin + '/api/auth/login', body={
            'username': credentials['username'], 'password': credentials['password']})
        logged_in = True
        if session.get('passwordChangeRequired') is not False:
            raise ValueError('Smoke account must finish first password change')
        cookies = [cookie for cookie in jar if cookie.name == 'mad_session']
        if (len(cookies) != 1 or not cookies[0].secure
                or not cookies[0].has_nonstandard_attr('HttpOnly')
                or cookies[0].get_nonstandard_attr('SameSite', '').lower() != 'strict'):
            raise ValueError('Unsafe session cookie')
        call(app_origin + '/api/auth/session')
        overview = call(app_origin + '/api/analytics?period=day')
        if not isinstance(overview.get('bookings', {}).get('total'), int):
            raise ValueError('Analytics smoke failed')
    finally:
        if logged_in:
            call(app_origin + '/api/auth/logout', body={})
    call(app_origin + '/api/analytics?period=day', expected=401)
