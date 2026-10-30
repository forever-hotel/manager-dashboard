import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import NotificationsPanel, { NotificationsBanner, NotificationsProvider } from '@/components/Notifications';
import { Sidebar } from '@/components/Sidebar';
import { notificationsFixture } from './notifications-fixture';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/notifications' }));
let handlers: Record<string, (value?: unknown) => void>,
  data: ReturnType<typeof notificationsFixture>,
  fetchMock: ReturnType<typeof vi.fn>,
  failed: boolean;
beforeEach(() => {
  data = notificationsFixture();
  failed = false;
  handlers = {};
  vi.mocked(io).mockReturnValue({
    on: (name: string, handler: (v?: unknown) => void) => {
      handlers[name] = handler;
    },
    removeAllListeners: vi.fn(),
    disconnect: vi.fn()
  } as unknown as ReturnType<typeof io>);
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('ticket'))
      return new Response(
        JSON.stringify({
          ticket: 'a'.repeat(43),
          socketUrl: 'http://localhost:4000'
        })
      );
    if (options?.method === 'PATCH') {
      data = {
        ...data,
        unread: 1,
        items: data.items.map((item, index) => (index === 0 ? { ...item, isRead: true } : item))
      };
      return new Response(JSON.stringify({ read: true }));
    }
    return new Response(JSON.stringify(data), { status: failed ? 503 : 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <NotificationsProvider>
      <Sidebar open={false} close={() => {}} username="manager" />
      <NotificationsBanner />
      <NotificationsPanel />
    </NotificationsProvider>
  );
}
describe('DDP-043 shared persistent notification presentation', () => {
  it('returns to the previous page from Notifications', () => {
    const previous = Object.getOwnPropertyDescriptor(window.history, 'length');

    Object.defineProperty(window.history, 'length', { configurable: true, value: 2 });
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    try {
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Back to previous page' }));
      expect(back).toHaveBeenCalledOnce();
    } finally {
      back.mockRestore();
      if (previous) Object.defineProperty(window.history, 'length', previous);
      else Reflect.deleteProperty(window.history, 'length');
    }
  });
  it.each([409, 503, 401, 403])('handles read failure %s without reporting a resolved issue', async status => {
    const original = fetchMock.getMockImplementation() as (url: string, options?: RequestInit) => Promise<Response>;

    fetchMock.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'PATCH' ? Promise.resolve(new Response('{}', { status })) : original(url, options)
    );
    mount();
    await screen.findByText('2 active alerts; 2 unread. Counts include every page.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark read' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 401 || status === 403
        ? 'Please sign in again.'
        : status === 409
          ? 'The alert changed.'
          : 'Unable to mark read.'
    );
    expect(screen.queryByText('No active complaints or stock problems.')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Current alerts' })).toBeInTheDocument();
  });
  it('shows an unknown initial count when the source is unavailable', async () => {
    failed = true;
    mount();
    await waitFor(() => expect(screen.getAllByText(/Data is stale or unavailable/).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Retry notifications' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Current alerts' })).toBeInTheDocument();
    expect(screen.queryByText('No active complaints or stock problems.')).not.toBeInTheDocument();
  });
  it('AC1: uses one snapshot for the panel, top area and navigation badge with safe detail links', async () => {
    mount();
    expect(await screen.findByText('2 active alerts; 2 unread. Counts include every page.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Current alerts' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Current alerts' })).getByText(/2 active alerts:/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'View complaint details' })).toHaveAttribute('href', data.items[0].href);
    expect(screen.getByRole('link', { name: 'View stock alert details' })).toHaveAttribute('href', data.items[1].href);
  });
  it('AC2: marking read preserves active counts; authoritative recovery removes issues', async () => {
    mount();
    await screen.findByText('2 active alerts; 2 unread. Counts include every page.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark read' })[0]);
    expect(await screen.findByText('2 active alerts; 1 unread. Counts include every page.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Current alerts' })).toBeInTheDocument();
    await waitFor(() => expect(handlers['notifications.changed']).toBeDefined());
    data = {
      ...data,
      items: [],
      total: 0,
      unread: 0,
      counts: { complaints: 0, stock: 0 }
    };
    act(() => handlers['notifications.changed']({}));
    expect(await screen.findByText('No active complaints or stock problems.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Current alerts' })).toBeInTheDocument();
  });
  it('AC3: duplicate/reconnect invalidations do not duplicate issues and source failure retains the last count', async () => {
    mount();
    await screen.findByText('2 active alerts; 2 unread. Counts include every page.');
    await waitFor(() => expect(handlers['notifications.changed']).toBeDefined());
    act(() => {
      handlers['notifications.changed']({});
      handlers['notifications.changed']({});
      handlers.connect();
    });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Mark read' })).toHaveLength(2));
    failed = true;
    act(() => handlers['notifications.changed']({}));
    await waitFor(() => expect(screen.getAllByText(/Data is stale or unavailable/).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Current alerts' })).toBeInTheDocument());
    expect(screen.queryByText('No active complaints or stock problems.')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Retry notifications' })).toBeVisible();
  });
  it('reports missing provider instead of rendering an empty state', () => {
    render(<NotificationsPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
  });
});
