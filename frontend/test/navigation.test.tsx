import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from '@/components/ClientLayout';
import { Sidebar } from '@/components/Sidebar';
import { SessionBoundary } from '@/components/SessionBoundary';
vi.mock('next/navigation', () => ({
  usePathname: () => '/rooms',
  useRouter: () => ({ refresh: vi.fn() }),
}));
const session = {
  sub: 'id',
  username: 'manager',
  role: 'MANAGER' as const,
  expiresAt: Math.floor(Date.now() / 1000) + 28800,
  passwordChangeRequired: false,
};
describe('Dashboard shell', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('provides all destinations, current-page semantics and a mobile navigation control', () => {
    render(
      <ClientLayout session={session}>
        <p>Protected content</p>
      </ClientLayout>,
    );
    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Close navigation' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('link')).toHaveLength(13);
    expect(screen.getByRole('link', { name: 'Rooms' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Rooms' }));
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
  it('offers a retry when logout fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    render(<Sidebar open close={() => {}} username="manager" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
  it('hides protected content while rechecking and on provider failure, then allows retry', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    render(
      <SessionBoundary session={session}>
        <p>Protected content</p>
      </SessionBoundary>,
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(session)));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Protected content')).toBeVisible();
  });
  it('checks an idle visible session periodically', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(session))),
    );
    const view = render(
      <SessionBoundary session={session}>
        <p>Protected content</p>
      </SessionBoundary>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(fetch).toHaveBeenCalled();
    view.unmount();
  });
});
