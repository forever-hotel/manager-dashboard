export function httpUrl(name: string, value: string | undefined): string {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(
      `Configuration: ${name} must be a valid HTTP(S) URL without credentials`,
    );
  }
}
export function serverConfig() {
  const origin = httpUrl('APP_ORIGIN', process.env.APP_ORIGIN);
  if (new URL(origin).pathname !== '/')
    throw new Error('Configuration: APP_ORIGIN must not include a path');
  const parsed = new URL(origin);
  if (
    process.env.NODE_ENV === 'production' &&
    parsed.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  )
    throw new Error(
      'Configuration: APP_ORIGIN must use HTTPS outside localhost',
    );
  const api = httpUrl('BACKEND_API_URL', process.env.BACKEND_API_URL);
  if (new URL(api).pathname !== '/')
    throw new Error(
      'Configuration: BACKEND_API_URL must be an origin without a path',
    );
  const apiMode = process.env.BACKEND_API_MODE ?? 'gateway';
  if (!['gateway', 'direct'].includes(apiMode))
    throw new Error(
      'Configuration: BACKEND_API_MODE must be gateway or direct',
    );
  return {
    origin,
    api,
    apiMode,
  };
}
