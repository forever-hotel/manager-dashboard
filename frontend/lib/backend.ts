import { serverConfig } from './environment';

export async function backend(
  path: string,
  method = 'GET',
  token?: string,
  body?: unknown,
) {
  try {
    const config = serverConfig();
    // Keep backend-native paths at call sites; adapt only at the transport boundary.
    const gatewayPath =
      config.apiMode === 'gateway' &&
      (path.startsWith('/auth/') || path.startsWith('/health/'))
        ? '/mad' + path
        : path;
    const response = await fetch(config.api + gatewayPath, {
      method,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(7000),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data: unknown = await response.json();
    // Rate limits are transient, not evidence that a manager session is invalid.
    if (response.status === 429)
      return {
        status: 503,
        data: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please retry shortly.',
        },
      };
    return { status: response.status, data };
  } catch {
    return {
      status: 503,
      data: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable. Please retry.',
      },
    };
  }
}
