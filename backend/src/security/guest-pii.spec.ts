import {
  decryptPii,
  encryptPii,
  emailLookup,
  piiSearchTokens,
  piiSearchQuery,
  guestPiiTransformer,
  validateGuestPiiConfig
} from './guest-pii';
describe('guest PII storage contract', () => {
  const previous = { ...process.env };
  beforeEach(() => {
    process.env.GUEST_PII_ENABLED = 'true';
    process.env.GUEST_PII_KEY = Buffer.alloc(32, 7).toString('base64');
    delete process.env.GUEST_PII_REQUIRE_ENCRYPTED;
  });
  afterEach(() => {
    for (const name of ['GUEST_PII_ENABLED', 'GUEST_PII_KEY', 'GUEST_PII_REQUIRE_ENCRYPTED']) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  it('randomizes encryption and authenticates the field and ciphertext', () => {
    const a = encryptPii('Guest Name', 'full_name')!;
    const b = encryptPii('Guest Name', 'full_name')!;
    expect(a).not.toBe(b);
    expect(a).not.toContain('Guest Name');
    expect(decryptPii(a, 'full_name')).toBe('Guest Name');
    expect(() => decryptPii(a, 'email')).toThrow('decryption failed');
    const data = Buffer.from(a.slice(7), 'base64');
    data[data.length - 1] ^= 1;
    expect(() => decryptPii('pii:v1:' + data.toString('base64'), 'full_name')).toThrow('decryption failed');
  });
  it('normalizes keyed email lookup and supports substring candidate search', () => {
    expect(emailLookup(' User@Example.com ')).toBe(emailLookup('user@example.com'));
    const stored = piiSearchTokens(['Guest Name', 'user@example.com']);
    expect(piiSearchQuery('est na').every(t => stored.includes(t))).toBe(true);
    expect(stored).not.toContain('Guest Name');
    process.env.GUEST_PII_KEY = Buffer.alloc(32, 8).toString('base64');
    expect(emailLookup('user@example.com')).not.toBe(emailLookup('other@example.com'));
  });
  it('requires a key and supports an explicit strict post-conversion mode', () => {
    expect(decryptPii('legacy', 'full_name')).toBe('legacy');
    process.env.GUEST_PII_REQUIRE_ENCRYPTED = 'true';
    expect(() => decryptPii('legacy', 'full_name')).toThrow('Unconverted');
    expect(decryptPii(null, 'email')).toBeNull();
    expect(() => validateGuestPiiConfig({ GUEST_PII_ENABLED: 'true', GUEST_PII_KEY: 'bad' })).toThrow('32-byte');
    expect(() => validateGuestPiiConfig({ GUEST_PII_ENABLED: 'tru' })).toThrow('Invalid');
    expect(() => validateGuestPiiConfig({ GUEST_PII_ENABLED: true, GUEST_PII_KEY: {} })).toThrow('32-byte');
  });
  it('rejects wrong keys, malformed ciphertext and inconsistent activation settings', () => {
    const encrypted = encryptPii('Private', 'full_name')!;
    process.env.GUEST_PII_KEY = Buffer.alloc(32, 8).toString('base64');
    expect(() => decryptPii(encrypted, 'full_name')).toThrow('decryption failed');
    expect(() => decryptPii('pii:v1:bad', 'full_name')).toThrow('decryption failed');
    delete process.env.GUEST_PII_KEY;
    expect(() => emailLookup('guest@example.com')).toThrow('32-byte');
    expect(() => validateGuestPiiConfig({ GUEST_PII_REQUIRE_ENCRYPTED: true, GUEST_PII_ENABLED: false })).toThrow(
      'require'
    );
    expect(() => validateGuestPiiConfig({ GUEST_PII_REQUIRE_ENCRYPTED: 'true', GUEST_PII_ENABLED: 'false' })).toThrow(
      'require'
    );
    expect(() => validateGuestPiiConfig({ GUEST_PII_ENABLED: true })).toThrow('32-byte');
    expect(() => validateGuestPiiConfig({ GUEST_PII_REQUIRE_ENCRYPTED: 'invalid' })).toThrow('Invalid');
  });
  it('supports nulls, explicit legacy mode, and TypeORM transformation without exposing index terms', () => {
    expect(encryptPii(null, 'phone')).toBeNull();
    const transformer = guestPiiTransformer('phone');
    expect(transformer.from(transformer.to('0771234567'))).toBe('0771234567');
    expect(piiSearchTokens([null, undefined, ''])).toEqual([]);
    expect(piiSearchQuery('')).toEqual([]);
    expect(piiSearchQuery('a')).toHaveLength(1);
    expect(piiSearchQuery('ab')).toHaveLength(1);
    expect(() =>
      validateGuestPiiConfig({ GUEST_PII_ENABLED: true, GUEST_PII_KEY: process.env.GUEST_PII_KEY })
    ).not.toThrow();
    expect(() => validateGuestPiiConfig({})).not.toThrow();
    process.env.GUEST_PII_ENABLED = 'false';
    expect(encryptPii('Legacy', 'full_name')).toBe('Legacy');
  });
  it('blocks plaintext SQL parameter logging during encrypted operation', () => {
    expect(() => validateGuestPiiConfig({ GUEST_PII_ENABLED: 'true', DB_LOGGING: 'true' })).toThrow('DB_LOGGING');
    expect(() => validateGuestPiiConfig({ GUEST_PII_ENABLED: true, DB_LOGGING: true })).toThrow('DB_LOGGING');
  });
});
