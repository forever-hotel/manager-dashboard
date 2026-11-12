import { createDecipheriv, createHmac } from 'node:crypto';

const prefix = 'pii:v1:';
function key(purpose: string): Buffer {
  const encoded = process.env.GUEST_PII_KEY ?? '';
  const root = Buffer.from(encoded, 'base64');
  if (root.length !== 32 || root.toString('base64') !== encoded)
    throw new Error('GUEST_PII_KEY must be a base64-encoded 32-byte key');
  return createHmac('sha256', root)
    .update('forever-hotel-guest-pii-v1:' + purpose)
    .digest();
}
export function validateGuestPiiConfig(env: Record<string, unknown>): void {
  for (const flag of ['GUEST_PII_ENABLED', 'GUEST_PII_REQUIRE_ENCRYPTED'])
    if (env[flag] !== undefined && !['true', 'false', true, false].includes(env[flag] as string))
      throw new Error('Invalid ' + flag);
  const enabled = env.GUEST_PII_ENABLED === 'true' || env.GUEST_PII_ENABLED === true;
  if ((env.GUEST_PII_REQUIRE_ENCRYPTED === 'true' || env.GUEST_PII_REQUIRE_ENCRYPTED === true) && !enabled)
    throw new Error('Encrypted-only reads require GUEST_PII_ENABLED');
  if (enabled && (env.DB_LOGGING === 'true' || env.DB_LOGGING === true))
    throw new Error('DB_LOGGING must be false when guest PII encryption is enabled');
  if (enabled) {
    const encoded = env.GUEST_PII_KEY;
    if (typeof encoded !== 'string') throw new Error('GUEST_PII_KEY must be a base64-encoded 32-byte key');
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== encoded)
      throw new Error('GUEST_PII_KEY must be a base64-encoded 32-byte key');
  }
}
export function decryptPii(value: string | null, field: string): string | null {
  if (value == null) return null;
  if (!value.startsWith(prefix)) {
    if (process.env.GUEST_PII_REQUIRE_ENCRYPTED === 'true') throw new Error('Unconverted guest PII');
    return value;
  }
  try {
    const data = Buffer.from(value.slice(prefix.length), 'base64');
    if (data.length < 28) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key('encryption'), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(field));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Guest PII decryption failed');
  }
}
