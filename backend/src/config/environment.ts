export function validateEnvironment(env: Record<string, unknown>) {
  const required = (name: string) => {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`Configuration: ${name} is required`);
    return value;
  };
  for (const name of ['DATABASE_URL', 'FRONTEND_URL']) {
    const value = required(name);
    try {
      const url = new URL(value);
      const protocols =
        name === 'DATABASE_URL'
          ? ['postgres:', 'postgresql:']
          : ['http:', 'https:'];
      if (
        !protocols.includes(url.protocol) ||
        !url.hostname ||
        url.hash ||
        url.search
      )
        throw new Error();
      if (
        name !== 'DATABASE_URL' &&
        (url.username ||
          url.password ||
          (name === 'FRONTEND_URL' && url.pathname !== '/') ||
          (env.NODE_ENV === 'production' && url.protocol !== 'https:'))
      )
        throw new Error();
    } catch {
      throw new Error(
        `Configuration: ${name} must be a valid ${name === 'DATABASE_URL' ? 'PostgreSQL' : 'HTTP(S)'} URL (HTTPS in production)`,
      );
    }
  }
  if (required('JWT_SECRET').length < 32)
    throw new Error(
      'Configuration: JWT_SECRET must contain at least 32 characters',
    );
  required('JWT_ISSUER');
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Configuration: PORT must be an integer from 1 to 65535');
  return { ...env, PORT: port };
}
