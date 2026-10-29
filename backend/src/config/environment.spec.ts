import { validateEnvironment } from './environment';
describe('Startup configuration', () => {
  const valid = {
    DATABASE_URL: 'postgresql://mad:password@localhost:5432/mad',
    FRONTEND_URL: 'http://localhost:3000',
    AUTH_SERVICE_URL: 'http://localhost:8080',
    SHARED_WEBSOCKET_URL: 'http://localhost:4100',
    MAD_WEBSOCKET_RELAY_KEY: 'shared-socket-test-key-at-least-32-characters'
  };
  it('requires explicit publication enablement and a broker URL when enabled', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      MAD_PROMOTIONS_PUBLISH_ENABLED: 'false'
    });
    expect(() => validateEnvironment({ ...valid, MAD_PROMOTIONS_PUBLISH_ENABLED: 'yes' })).toThrow(
      'MAD_PROMOTIONS_PUBLISH_ENABLED'
    );
    expect(() => validateEnvironment({ ...valid, MAD_PROMOTIONS_PUBLISH_ENABLED: 'true' })).toThrow('RABBITMQ_URL');
    expect(
      validateEnvironment({
        ...valid,
        MAD_PROMOTIONS_PUBLISH_ENABLED: 'true',
        RABBITMQ_URL: 'amqp://localhost/mad_test'
      })
    ).toMatchObject({ MAD_PROMOTIONS_PUBLISH_ENABLED: 'true' });
  });
  it.each(['', 'invalid', '-0.1', '1.01'])('rejects invalid alert configuration at startup: %s', value => {
    expect(() => validateEnvironment({ ...valid, LOW_BOOKING_THRESHOLD: value })).toThrow('LOW_BOOKING_THRESHOLD');
  });
  it('accepts valid local configuration and a numeric port', () => {
    expect(validateEnvironment(valid).PORT).toBe(4000);
    expect(validateEnvironment({ ...valid, PORT: '4100' }).PORT).toBe(4100);
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://mad.test'
      }).PORT
    ).toBe(4000);
  });
  it('blocks production query logging without echoing credentials', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://mad.test',
        DB_LOGGING: 'true'
      })
    ).toThrow('DB_LOGGING must be false');
    // Staff configuration also rejects parameter logging in local environments.
    expect(() => validateEnvironment({ ...valid, DB_LOGGING: 'true' })).toThrow('DB_LOGGING must be false');
  });
  it('validates optional realtime configuration without exposing broker credentials', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      MAD_REALTIME_ENABLED: 'false'
    });
    expect(
      validateEnvironment({
        ...valid,
        MAD_REALTIME_ENABLED: 'true',
        RABBITMQ_URL: 'amqp://localhost/mad_test'
      })
    ).toMatchObject({ MAD_REALTIME_ENABLED: 'true' });
    for (const value of ['yes', ''])
      expect(() => validateEnvironment({ ...valid, MAD_REALTIME_ENABLED: value })).toThrow('MAD_REALTIME_ENABLED');
    for (const value of [undefined, 'private-secret', 'http://localhost'])
      expect(() =>
        validateEnvironment({
          ...valid,
          MAD_REALTIME_ENABLED: 'true',
          RABBITMQ_URL: value
        })
      ).toThrow('RABBITMQ_URL must be an AMQP URL');
  });
  it.each(['DATABASE_URL', 'FRONTEND_URL', 'AUTH_SERVICE_URL'])('names missing %s without exposing values', key => {
    expect(() => validateEnvironment({ ...valid, [key]: undefined })).toThrow(key);
  });
  it.each(['DATABASE_URL', 'FRONTEND_URL', 'AUTH_SERVICE_URL'])('redacts invalid %s', key => {
    try {
      validateEnvironment({ ...valid, [key]: 'secret-value' });
      throw new Error('expected validation failure');
    } catch (error) {
      expect((error as Error).message).toContain(key);
      expect((error as Error).message).not.toContain('secret-value');
    }
  });
  it.each(['ftp://test', 'http://user:password@test', 'http://test#fragment', 'http://test?query=x'])(
    'rejects unsafe service URL %s',
    url => {
      expect(() => validateEnvironment({ ...valid, FRONTEND_URL: url })).toThrow('FRONTEND_URL');
    }
  );
  it('rejects insecure production frontend URLs and unsafe auth origins', () => {
    expect(() => validateEnvironment({ ...valid, NODE_ENV: 'production' })).toThrow('FRONTEND_URL');
    expect(() => validateEnvironment({ ...valid, AUTH_SERVICE_URL: 'http://user:password@test' })).toThrow(
      'AUTH_SERVICE_URL'
    );
  });
  it.each([0, 65536, 'bad', 1.5])('rejects invalid port %s', PORT => {
    expect(() => validateEnvironment({ ...valid, PORT })).toThrow('PORT');
  });
});
