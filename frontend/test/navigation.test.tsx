import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from '@/components/ClientLayout';
import { Sidebar } from '@/components/Sidebar';
import { replaceLocation } from '@/lib/navigation';
vi.mock('@/lib/navigation', () => ({ replaceLocation: vi.fn() }));
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
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); vi.mocked(replaceLocation).mockClear(); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('retains all routes, mobile navigation and keyboard semantics', () => {
    render(<ClientLayout session={session}><p>Protected content</p></ClientLayout>);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('link')).toHaveLength(13);
    const rooms = screen.getByRole('link', { name: 'Room status' });
    expect(rooms).toHaveAttribute('aria-current', 'page');
    fireEvent.click(rooms);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#dashboard-content');
  });
  it('shows the authenticated username and completes server logout', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}'));
    render(<Sidebar open close={() => {}} username="actual-manager" />);
    expect(screen.getByText('actual-manager')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await vi.waitFor(() => expect(replaceLocation).toHaveBeenCalledWith('/login'));
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST', body: '{}' }));
  });
  it('keeps logout retryable when the server fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    render(<Sidebar open close={() => {}} username="manager" />);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry');
    expect(replaceLocation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeEnabled();
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
