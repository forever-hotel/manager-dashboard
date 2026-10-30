import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagerPasswordReset } from '@/components/ManagerPasswordReset';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('Manager email password recovery', () => {
  it('requests an email code, validates matching passwords, and returns to sign-in after success', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Check your email.' })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Password changed. Sign in with your new password.' }))
      );
    vi.stubGlobal('fetch', send);
    render(<ManagerPasswordReset />);
    fireEvent.change(screen.getByLabelText('Manager email'), { target: { value: 'manager@example.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
    expect(await screen.findByLabelText('Email verification code')).toBeVisible();
    expect(send).toHaveBeenCalledWith(
      '/api/auth/request-password-reset',
      expect.objectContaining({ body: JSON.stringify({ email: 'manager@example.invalid' }) })
    );
    fireEvent.change(screen.getByLabelText('Email verification code'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New password', { exact: true }), {
      target: { value: 'new-private-password' }
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'different-private-password' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('matching passwords');
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-private-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed');
    expect(screen.queryByLabelText('New password', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });
  it('shows a provider/configuration error and allows retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ message: 'Password reset is unavailable.' }), { status: 503 }))
        )
    );
    render(<ManagerPasswordReset />);
    fireEvent.change(screen.getByLabelText('Manager email'), { target: { value: 'manager@example.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send verification code' })).not.toBeDisabled());
  });
});
