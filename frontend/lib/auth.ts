export const SESSION_COOKIE = 'mad_session';
export type Session = {
  sub: string;
  username: string;
  role: 'MANAGER' | 'ROOT';
  roles?: string[];
  expiresAt: number;
  passwordChangeRequired: boolean;
};

export function safeDestination(value: string | null | undefined) {
  if (!value || !/^\/(?!\/)/.test(value) || /[\\\r\n]/.test(value)) return '/analytics';
  const path = value.split(/[?#]/)[0];

  return [
    '/analytics',
    '/rooms',
    '/promotions',
    '/staff',
    '/notifications',
    '/complaints',
    '/food-orders',
    '/service-requests',
    '/worker-performance',
    '/tasks'
  ].includes(path)
    ? value
    : '/analytics';
}

export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const session = value as Session;

  return (
    typeof session.sub === 'string' &&
    typeof session.username === 'string' &&
    ['MANAGER', 'ROOT'].includes(session.role) &&
    Number.isInteger(session.expiresAt) &&
    session.expiresAt > Date.now() / 1000 &&
    typeof session.passwordChangeRequired === 'boolean'
  );
}

// Explicitly select browser-safe fields; never forward arbitrary provider data.
export function publicSession(session: Session): Session {
  return {
    sub: session.sub,
    username: session.username,
    role: session.role,
    roles: session.roles,
    expiresAt: session.expiresAt,
    passwordChangeRequired: session.passwordChangeRequired
  };
}
