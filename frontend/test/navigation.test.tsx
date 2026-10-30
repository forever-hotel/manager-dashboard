import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from '@/components/ClientLayout';
import { Sidebar } from '@/components/Sidebar';
import { replaceLocation } from '@/lib/navigation';

vi.mock('@/lib/navigation', () => ({ replaceLocation: vi.fn() }));

import { SessionBoundary } from '@/components/SessionBoundary';

vi.mock('next/navigation', () => ({
  usePathname: () => '/rooms',
  useRouter: () => ({ refresh: vi.fn() })
}));
const session = {
  sub: 'id',
  username: 'manager',
  role: 'MANAGER' as const,
  expiresAt: Math.floor(Date.now() / 1000) + 28800,
  passwordChangeRequired: false
};
describe('Dashboard shell', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(replaceLocation).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('retains all routes, mobile navigation and keyboard semantics', () => {
    render(
      <ClientLayout session={session}>
        <p>Protected content</p>
      </ClientLayout>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('navigation', { name: 'Dashboard' }).querySelectorAll('a')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: /Open account menu/ }));
    for (const name of ['Notifications', 'Task queue']) expect(screen.getByRole('link', { name })).toBeVisible();
    const rooms = screen.getByRole('link', { name: 'Room status' });

    expect(rooms).toHaveAttribute('aria-current', 'page');
    fireEvent.click(rooms);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#dashboard-content');
  });
  it('dismisses account tools on outside interaction and when selecting a destination', () => {
    render(<Sidebar open close={() => {}} username="manager" />);
    const trigger = screen.getByRole('button', { name: /Open account menu/ });

    fireEvent.click(trigger);
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('navigation', { name: 'Account tools' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('link', { name: 'Task queue' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
  it('shows the authenticated username and completes server logout', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response('{}')));
    render(<Sidebar open close={() => {}} username="actual-manager" />);
    expect(screen.getByText('actual-manager')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Open account menu/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await vi.waitFor(() => expect(replaceLocation).toHaveBeenCalledWith('/login'));
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST', body: '{}' }));
  });
  it('DDP-048: isolates the open navigation and restores focus on Escape', () => {
    render(
      <ClientLayout session={session}>
        <p>Protected content</p>
      </ClientLayout>
    );
    const trigger = screen.getByRole('button', { name: 'Open navigation' });

    trigger.focus();
    fireEvent.click(trigger);
    expect(document.getElementById('dashboard-content')).toHaveAttribute('inert');
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('dashboard-content')).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
  });
  it('DDP-048: keeps forward and reverse Tab inside open navigation', () => {
    render(
      <ClientLayout session={session}>
        <p>Protected content</p>
      </ClientLayout>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const toggle = screen.getByRole('button', { name: 'Close navigation' });
    const logout = screen.getByRole('button', { name: /Open account menu/ });

    toggle.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(toggle).toHaveFocus();
    screen.getByRole('link', { name: 'Skip to content' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(toggle).toHaveFocus();
  });
  it('keeps logout retryable when the server fails', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response('{}', { status: 503 })));
    render(<Sidebar open close={() => {}} username="manager" />);
    fireEvent.click(screen.getByRole('button', { name: /Open account menu/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry');
    expect(replaceLocation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeEnabled();
  });
  it('keeps the dashboard mounted without polling or tab-change validation', async () => {
    vi.useFakeTimers();
    render(
      <SessionBoundary session={session}>
        <input aria-label="Unsaved draft" defaultValue="" />
      </SessionBoundary>
    );
    fireEvent.change(screen.getByLabelText('Unsaved draft'), { target: { value: 'Keep this draft' } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, Object.assign(new Event('pageshow'), { persisted: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180000);
    });
    expect(screen.getByLabelText('Unsaved draft')).toHaveValue('Keep this draft');
    expect(fetch).not.toHaveBeenCalled();
    expect(replaceLocation).not.toHaveBeenCalled();
  });
  it('still redirects when the authenticated session expires', async () => {
    vi.useFakeTimers();
    render(
      <SessionBoundary session={{ ...session, expiresAt: Math.floor(Date.now() / 1000) + 5 }}>
        <p>Protected content</p>
      </SessionBoundary>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(replaceLocation).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?reason=expired&next=/));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cleans up the expiry timer when the layout unmounts', async () => {
    vi.useFakeTimers();
    const view = render(
      <SessionBoundary session={{ ...session, expiresAt: Math.floor(Date.now() / 1000) + 5 }}>
        <p>Protected content</p>
      </SessionBoundary>
    );

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(replaceLocation).not.toHaveBeenCalled();
  });
});
