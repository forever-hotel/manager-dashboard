import { isEmail } from 'class-validator';

export function validateStaffConfig(env: Record<string, unknown>) {
  const enabled = env.STAFF_EMAIL_ENABLED ?? 'false';

  if (enabled !== 'true' && enabled !== 'false')
    throw new Error('Configuration: STAFF_EMAIL_ENABLED must be true or false');
  const key = env.STAFF_CREDENTIALS_KEY;

  if (
    key !== undefined &&
    key !== '' &&
    (typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32)
  )
    throw new Error('Configuration: STAFF_CREDENTIALS_KEY must be a base64-encoded 32-byte key');
  if (
    enabled === 'true' &&
    (!key ||
      typeof env.BREVO_API_KEY !== 'string' ||
      !env.BREVO_API_KEY.trim() ||
      typeof env.STAFF_EMAIL_FROM !== 'string' ||
      !isEmail(env.STAFF_EMAIL_FROM))
  )
    throw new Error(
      'Configuration: enabled staff email requires STAFF_CREDENTIALS_KEY, BREVO_API_KEY and a verified STAFF_EMAIL_FROM'
    );
  // Profile/credential SQL parameters must never enter the application log.
  if (env.DB_LOGGING === 'true')
    throw new Error('Configuration: DB_LOGGING must be false to protect staff credentials and personal data');
}
