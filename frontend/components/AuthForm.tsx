'use client';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { safeDestination } from '@/lib/auth';
import { navigate } from '@/lib/navigation';
const schema = z.object({
  username: z.string().trim().min(1, 'Username is required.').max(100),
  password: z.string().min(1, 'Password is required.').max(1024),
});
type Values = z.infer<typeof schema>;
export function AuthForm({
  next,
  expired = false,
  changePassword = false,
}: {
  next?: string;
  expired?: boolean;
  changePassword?: boolean;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const formSchema = changePassword
    ? schema.extend({ username: z.string().min(1).max(1024) })
    : schema;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(formSchema) });
  async function submit(data: Values) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        '/api/auth/' + (changePassword ? 'change-password' : 'login'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify(
            changePassword
              ? { currentPassword: data.username, newPassword: data.password }
              : data,
          ),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status >= 500
            ? 'Service unavailable. Please retry.'
            : 'Unable to sign in. Check your details and try again.',
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
          : safeDestination(next),
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
              : 'Unable to sign in. Please retry.',
      );
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-4">
      <section className="w-full max-w-sm rounded-lg border border-gray-200 p-8">
        <h1 className="text-xl font-semibold">
          {changePassword ? 'Change your password' : 'Manager sign in'}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {changePassword
            ? 'Set a new password before accessing your dashboard.'
            : 'Sign in to Forever Hotel.'}
        </p>
        {expired && (
          <p role="status" className="mt-3 text-sm">
            Your session ended. Please sign in again.
          </p>
        )}
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(submit)(event)}
          className="mt-6 space-y-4"
        >
          <div>
            <label htmlFor="username">
              {changePassword ? 'Current password' : 'Username'}
            </label>
            <input
              id="username"
              type={changePassword ? 'password' : 'text'}
              autoComplete={changePassword ? 'current-password' : 'username'}
              aria-invalid={!!errors.username}
              aria-describedby={errors.username ? 'username-error' : undefined}
              className="mt-1 w-full rounded border p-2"
              {...register('username')}
            />
            {errors.username && (
              <p id="username-error" role="alert">
                {changePassword
                  ? 'Current password is required.'
                  : errors.username.message}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="password">
              {changePassword ? 'New password' : 'Password'}
            </label>
            <input
              id="password"
              type="password"
              autoComplete={
                changePassword ? 'new-password' : 'current-password'
              }
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              className="mt-1 w-full rounded border p-2"
              {...register('password')}
            />
            {errors.password && (
              <p id="password-error" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={isSubmitting || pending}
            className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {isSubmitting || pending
              ? 'Please wait…'
              : changePassword
                ? 'Change password'
                : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
