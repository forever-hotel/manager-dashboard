import { validateEnvironment } from './environment';
describe('Startup configuration', () => {
  const valid = {
    DATABASE_URL: 'postgresql://mad:password@localhost:5432/mad',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_SECRET: 'test-secret-with-at-least-32-characters',
    JWT_ISSUER: 'mad',
  };
  it.each(['', 'invalid', '-0.1', '1.01'])('rejects invalid alert configuration at startup: %s', (value) => {
    expect(() => validateEnvironment({ ...valid, LOW_BOOKING_THRESHOLD: value })).toThrow('LOW_BOOKING_THRESHOLD');
  });
  it('accepts valid local configuration and a numeric port', () => {
    expect(validateEnvironment(valid).PORT).toBe(4000);
    expect(validateEnvironment({ ...valid, PORT: '4100' }).PORT).toBe(4100);
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://mad.test',
      }).PORT,
    ).toBe(4000);
  });
  it.each(Object.keys(valid))(
    'names missing %s without exposing values',
    (key) => {
      expect(() => validateEnvironment({ ...valid, [key]: undefined })).toThrow(
        key,
      );
    },
  );
  it.each(['DATABASE_URL', 'FRONTEND_URL'])(
    'redacts invalid %s',
    (key) => {
      try {
        validateEnvironment({ ...valid, [key]: 'secret-value' });
        throw new Error('expected validation failure');
      } catch (error) {
        expect((error as Error).message).toContain(key);
        expect((error as Error).message).not.toContain('secret-value');
      }
    },
  );
  it.each([
    'ftp://test',
    'http://user:password@test',
    'http://test#fragment',
    'http://test?query=x',
  ])('rejects unsafe service URL %s', (url) => {
    expect(() =>
      validateEnvironment({ ...valid, FRONTEND_URL: url }),
    ).toThrow('FRONTEND_URL');
  });
  it('rejects insecure production service URLs and short signing secrets', () => {
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'production' }),
    ).toThrow('FRONTEND_URL');
    expect(() =>
      validateEnvironment({ ...valid, JWT_SECRET: 'short' }),
    ).toThrow('JWT_SECRET');
  });
  it.each([0, 65536, 'bad', 1.5])('rejects invalid port %s', (PORT) => {
    expect(() => validateEnvironment({ ...valid, PORT })).toThrow('PORT');
  });
});
