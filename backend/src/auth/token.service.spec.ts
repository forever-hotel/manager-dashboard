import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

describe('Staff token policy', () => {
  const secret = 'test-only-secret-with-more-than-32-characters';
  const jwt = new JwtService({ secret });
  const service = new TokenService(
    jwt,
    new ConfigService({ JWT_SECRET: secret, JWT_ISSUER: 'central-auth' }),
  );
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'MANAGER',
    iss: 'central-auth',
    iat: now,
    exp: now + 28800,
  };
  it('accepts an eight-hour HS256 staff token from the configured issuer', () => {
    expect(service.verify(jwt.sign(claims))).toEqual(claims);
  });
  it.each([
    ['sub', undefined],
    ['sub', 'not-a-uuid'],
    ['role', undefined],
    ['role', 3],
    ['iss', undefined],
    ['iss', 'another-provider'],
    ['iat', undefined],
    ['iat', now + 1],
    ['iat', now + 0.5],
    ['exp', undefined],
    ['exp', now - 1],
    ['exp', now + 604800],
    ['exp', now + 28800.5],
  ])('rejects invalid %s claim (%s)', (field, value) => {
    const payload: Record<string, unknown> = { ...claims, [field]: value };
    if (value === undefined) delete payload[field];
    // jsonwebtoken supplies iat automatically unless explicitly suppressed.
    const token = jwt.sign(
      payload,
      field === 'iat' && value === undefined ? { noTimestamp: true } : {},
    );
    expect(() => service.verify(token)).toThrow('Unauthorized');
  });
  it.each(['HS384', 'HS512'] as const)(
    'rejects %s despite a valid signature',
    (algorithm) => {
      expect(() => service.verify(jwt.sign(claims, { algorithm }))).toThrow();
    },
  );
  it('rejects a different signing key and malformed input', () => {
    expect(() =>
      service.verify(jwt.sign(claims, { secret: 'another-secret' })),
    ).toThrow();
    expect(() => service.verify('garbage')).toThrow();
  });
});
