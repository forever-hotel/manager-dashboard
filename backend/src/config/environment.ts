import { lowBookingThreshold } from '../analytics/low-booking-config';
import { validateStaffConfig } from '../staff/staff-config';

export function validateEnvironment(env: Record<string, unknown>) {
  env = { ...env };
  validateStaffConfig(env);
  env.LOW_BOOKING_THRESHOLD = lowBookingThreshold(env.LOW_BOOKING_THRESHOLD);
  if (!env.DATABASE_URL) {
    for (const key of ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME']) {
      if (typeof env[key] !== 'string' || !env[key].trim())
        throw new Error(
          `Configuration: ${key} is required when DATABASE_URL is absent`,
        );
    }
    const dbPort = Number(env.DB_PORT ?? 5432);
    if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535)
      throw new Error(
        'Configuration: DB_PORT must be an integer from 1 to 65535',
      );
    if (!/^[a-zA-Z0-9.-]+$/.test(env.DB_HOST as string))
      throw new Error('Configuration: DB_HOST must be a hostname');
    env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USERNAME as string)}:${encodeURIComponent(env.DB_PASSWORD as string)}@${env.DB_HOST as string}:${dbPort}/${encodeURIComponent(env.DB_NAME as string)}`;
  }
  for (const key of ['DB_SSL', 'DB_SYNCHRONIZE', 'DB_LOGGING']) {
    const value = env[key] ?? 'false';
    if (value !== 'true' && value !== 'false')
      throw new Error(`Configuration: ${key} must be true or false`);
    env[key] = value;
  }
  if (env.DB_SYNCHRONIZE === 'true')
    throw new Error(
      'Configuration: DB_SYNCHRONIZE must be false; the shared schema is managed externally',
    );
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
