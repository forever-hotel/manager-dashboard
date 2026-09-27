import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from '@/components/AuthForm';
import { navigate } from '@/lib/navigation';
vi.mock('@/lib/navigation', () => ({ navigate: vi.fn() }));
describe('Manager sign in', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(navigate).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());
  function fill(username = 'manager', password = 'password') {
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: username },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: password },
    });
  }
  it('validates empty fields without sending credentials', async () => {
    render(<AuthForm expired />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Username is required.')).toBeVisible();
    expect(screen.getByText('Password is required.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shows a generic error and allows retry for rejected credentials', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }));
    render(<AuthForm />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to sign in',
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
  it('disables duplicate submissions and opens only the intended local destination', async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AuthForm next="/rooms" />);
    fill();
    const button = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    finish(new Response('{"passwordChangeRequired":false}'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms'));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('routes forced first login to password change', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"passwordChangeRequired":true}'),
    );
    render(<AuthForm next="/rooms" />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/change-password?next=%2Frooms'),
    );
  });
  it.each([503, 400])(
    'handles server status %i without navigating',
    async (status) => {
      vi.mocked(fetch).mockResolvedValue(new Response('{}', { status }));
      render(<AuthForm />);
      fill();
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      expect(await screen.findByRole('alert')).toBeVisible();
      expect(navigate).not.toHaveBeenCalled();
    },
  );
  it.each([
    new DOMException('timeout', 'TimeoutError'),
    new TypeError('network failure'),
    'unexpected',
  ])('offers retry after a failed request', async (cause) => {
    vi.mocked(fetch).mockRejectedValue(cause);
    render(<AuthForm />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
  it('preserves current-password whitespace and submits only the password-change fields', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"passwordChangeRequired":false}'),
    );
    render(<AuthForm changePassword />);
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: ' old password ' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/change-password',
        expect.objectContaining({
          body: JSON.stringify({
            currentPassword: ' old password ',
            newPassword: 'new password',
          }),
        }),
      ),
    );
  });
});
