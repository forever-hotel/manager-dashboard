import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const prefix = 'pii:v1:';
export function piiEnabled(): boolean {
  return process.env.GUEST_PII_ENABLED === 'true';
}
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
    const encoded = String(env.GUEST_PII_KEY ?? '');
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== encoded)
      throw new Error('GUEST_PII_KEY must be a base64-encoded 32-byte key');
  }
}
export function encryptPii(value: string | null, field: string): string | null {
  if (value === null || !piiEnabled()) return value;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key('encryption'), nonce);
  cipher.setAAD(Buffer.from(field));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return prefix + Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64');
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
export function emailLookup(email: string): string {
  return createHmac('sha256', key('email-lookup')).update(email.trim().toLowerCase()).digest('hex');
}
export function piiSearchTokens(values: (string | null | undefined)[]): string[] {
  const pieces = new Set<string>();
  for (const value of values) {
    const normalized = (value ?? '').trim().toLowerCase();
    for (let size = 1; size <= 3; size++)
      for (let i = 0; i <= normalized.length - size; i++) pieces.add(normalized.slice(i, i + size));
  }
  const secret = key('search');
  return [...pieces].map(piece => createHmac('sha256', secret).update(piece).digest('hex'));
}
export function piiSearchQuery(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  const size = Math.min(3, normalized.length);
  if (!size) return [];
  const secret = key('search');
  const pieces = new Set<string>();
  for (let i = 0; i <= normalized.length - size; i++)
    pieces.add(
      createHmac('sha256', secret)
        .update(normalized.slice(i, i + size))
        .digest('hex')
    );
  return [...pieces];
}
export function guestPiiTransformer(field: string) {
  return {
    to: (value: string | null) => encryptPii(value, field),
    from: (value: string | null) => decryptPii(value, field)
  };
}
