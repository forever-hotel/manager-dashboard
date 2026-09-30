import { hashPassword, validPassword, verifyPassword } from './password';

describe('Local password storage', () => {
  it('uses independent salts and verifies the complete password', async () => {
    const password = 'a-long-local-password';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password + 'x', first)).toBe(false);
    expect(await verifyPassword(password, 'malformed')).toBe(false);
    expect(await verifyPassword(password)).toBe(false);
  });
  it('accepts long passphrases and rejects weak lengths or whitespace', () => {
    expect(validPassword('a long passphrase')).toBe(true);
    for (const password of ['short', ' '.repeat(12), 'x'.repeat(1025)])
      expect(validPassword(password)).toBe(false);
  });
});
