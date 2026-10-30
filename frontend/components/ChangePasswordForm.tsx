'use client';

import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { safeDestination } from '@/lib/auth';
import { navigate } from '@/lib/navigation';

const schema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.').max(1024),
  newPassword: z.string().min(12, 'Use at least 12 characters.').max(1024)
});
type Values = z.infer<typeof schema>;

export function ChangePasswordForm({ next }: { next?: string }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<Values>({ resolver: zodResolver(schema) });
  async function submit(data: Values) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify(data)
      });

      if (!response.ok)
        throw new Error(
          response.status >= 500
            ? 'Service unavailable. Please retry.'
            : 'Unable to change password. Check your current password and use a different new password.'
        );
      const result: unknown = await response.json();

      if (
        !result ||
        typeof result !== 'object' ||
        !('passwordChangeRequired' in result) ||
        typeof result.passwordChangeRequired !== 'boolean'
      )
        throw new Error('Service unavailable. Please retry.');
      navigate(
        result.passwordChangeRequired
          ? '/change-password?next=' + encodeURIComponent(safeDestination(next))
          : safeDestination(next)
      );
    } catch (cause) {
      locked.current = false;
      setPending(false);
      setError(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'The request timed out. Please retry.'
          : cause instanceof TypeError
            ? 'Service unavailable. Please retry.'
            : cause instanceof Error
              ? cause.message
              : 'Unable to change password. Please retry.'
      );
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <section className="w-full max-w-sm rounded-lg border border-border p-8 bg-surface">
        <h1 className="font-medium text-[22px] text-brand">Change your password</h1>
        <p className="mt-2 text-sm text-muted">
          This is your first sign-in. Replace your initial password with a new password. Use the new password for future
          sign-ins.
        </p>
        <form noValidate onSubmit={event => void handleSubmit(submit)(event)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="currentPassword">Current password</label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.currentPassword}
              aria-describedby={errors.currentPassword ? 'current-password-error' : undefined}
              className="mt-1 w-full rounded border p-2"
              {...register('currentPassword')}
            />
            {errors.currentPassword && (
              <p id="current-password-error" role="alert">
                {errors.currentPassword.message}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="newPassword">New password</label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              aria-describedby={errors.newPassword ? 'password-error' : undefined}
              className="mt-1 w-full rounded border p-2"
              {...register('newPassword')}
            />
            {errors.newPassword && (
              <p id="password-error" role="alert">
                {errors.newPassword.message}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <button
            disabled={isSubmitting || pending}
            className="w-full rounded bg-brand px-4 py-2 text-white disabled:opacity-50 button button-primary"
          >
            {isSubmitting || pending ? 'Please wait…' : 'Change password'}
          </button>
        </form>
      </section>
    </main>
  );
}
