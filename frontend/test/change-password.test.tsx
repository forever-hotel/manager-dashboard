import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';
import { navigate } from '@/lib/navigation';

vi.mock('@/lib/navigation', () => ({ navigate: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.mocked(navigate).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function fill() {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: ' old password ' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new password123' } });
}
describe('Required first-login password change', () => {
  it('validates current password and minimum new-password length without submitting', async () => {
    render(<ChangePasswordForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Current password is required.')).toBeVisible();
    expect(screen.getByText('Use at least 12 characters.')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves password whitespace, prevents duplicate submission and opens the allowed destination', async () => {
    let finish!: (response: Response) => void;

    vi.mocked(fetch).mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    render(<ChangePasswordForm next="/rooms" />);
    fill();
    const button = screen.getByRole('button', { name: 'Change password' });

    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/change-password',
      expect.objectContaining({
        body: JSON.stringify({ currentPassword: ' old password ', newPassword: 'new password123' })
      })
    );
    finish(new Response('{"passwordChangeRequired":false}'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms'));
  });
  it.each([400, 401, 503])('keeps the password gate closed after HTTP %s', async status => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response('{}', { status })));
    render(<ChangePasswordForm />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled();
  });
  it.each([new DOMException('timeout', 'TimeoutError'), new TypeError('offline')])(
    'allows retry after a transport failure',
    async error => {
      vi.mocked(fetch).mockRejectedValue(error);
      render(<ChangePasswordForm />);
      fill();
      fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
      expect(await screen.findByRole('alert')).toBeVisible();
      expect(navigate).not.toHaveBeenCalled();
    }
  );
});
