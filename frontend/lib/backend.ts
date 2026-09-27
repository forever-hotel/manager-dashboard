import { serverConfig } from './environment';

export async function backend(
  path: string,
  method = 'GET',
  token?: string,
  body?: unknown,
) {
  try {
    const response = await fetch(serverConfig().api + path, {
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
