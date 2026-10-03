import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireSession } from '@/lib/session';
import ChangePasswordPage from '@/app/change-password/page';

vi.mock('@/lib/session', () => ({ requireSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock('@/components/AuthForm', () => ({ AuthForm: () => null }));

describe('First-login password page', () => {
  beforeEach(() => vi.clearAllMocks());
  const session = {
    sub: 'manager',
    username: 'manager',
    role: 'MANAGER' as const,
    expiresAt: 9999999999,
    passwordChangeRequired: true,
  };
  it('shows the password form while the database flag is true', async () => {
    vi.mocked(requireSession).mockResolvedValue(session);
    const page = await ChangePasswordPage({
      searchParams: Promise.resolve({ next: '/rooms' }),
    });
    expect(page.props).toMatchObject({ changePassword: true, next: '/rooms' });
  });
  it('opens the dashboard after the password has been changed', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ...session,
      passwordChangeRequired: false,
    });
    await expect(
      ChangePasswordPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('/analytics');
  });
  it('preserves a safe destination for returning managers', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ...session,
      passwordChangeRequired: false,
    });
    await expect(
      ChangePasswordPage({ searchParams: Promise.resolve({ next: '/rooms' }) }),
    ).rejects.toThrow('/rooms');
  });
});
