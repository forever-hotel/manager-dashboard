import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/components/LoginForm';

import { navigate } from '@/lib/navigation';
vi.mock('@/lib/navigation', () => ({ navigate: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Reference login design with real authentication', () => {
  it('shows expired-session feedback and validates empty credentials', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<LoginForm expired />);
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Username is required.')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('prevents duplicate submissions while login is pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    const button = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
  });
  it.each([true, false])('routes according to passwordChangeRequired=%s', async (required) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ passwordChangeRequired: required }))));
    render(<LoginForm next="/rooms" />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'private-test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(required ? '/change-password?next=%2Frooms' : '/rooms'));
    expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      body: JSON.stringify({ username: 'manager', password: 'private-test-password' }),
    }));
  });
  it('keeps failed authentication on the login page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Unable to sign in. Check your username and password.')).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });
});
