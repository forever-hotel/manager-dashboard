import { isEmail } from 'class-validator';

export function validateStaffConfig(env: Record<string, unknown>) {
  const enabled = env.STAFF_EMAIL_ENABLED ?? 'false';
  if (enabled !== 'true' && enabled !== 'false')
    throw new Error('Configuration: STAFF_EMAIL_ENABLED must be true or false');
  const key = env.STAFF_CREDENTIALS_KEY;
  if (
    key !== undefined &&
    key !== '' &&
    (typeof key !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
      Buffer.from(key, 'base64').length !== 32)
  )
    throw new Error(
      'Configuration: STAFF_CREDENTIALS_KEY must be a base64-encoded 32-byte key',
    );
  if (
    enabled === 'true' &&
    (!key ||
      typeof env.SENDGRID_API_KEY !== 'string' ||
      !env.SENDGRID_API_KEY.trim() ||
      typeof env.SENDGRID_FROM_EMAIL !== 'string' ||
      !isEmail(env.SENDGRID_FROM_EMAIL))
  )
    throw new Error(
      'Configuration: enabled staff email requires STAFF_CREDENTIALS_KEY, SENDGRID_API_KEY and a verified SENDGRID_FROM_EMAIL',
    );
  // Profile/credential SQL parameters must never enter the application log.
  if (env.DB_LOGGING === 'true')
    throw new Error(
      'Configuration: DB_LOGGING must be false to protect staff credentials and personal data',
    );
}
