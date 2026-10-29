'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { navigate } from '@/lib/navigation';
import { safeDestination } from '@/lib/auth';
import { Hotel, Lock, User, ArrowRight } from 'lucide-react';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required.').max(100),
  password: z.string().min(1, 'Password is required.').max(1024)
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm({ next, expired = false }: { next?: string; expired?: boolean }) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema)
  });

  const onSubmit = async (data: LoginFormValues) => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          username: data.username,
          password: data.password
        })
      });
      if (response.status === 429) {
        const value = response.headers.get('retry-after');
        const seconds = value && /^\d{1,6}$/.test(value) ? Math.max(1, Math.min(3600, Number(value))) : 60;
        throw new Error(`Too many sign-in attempts. Try again in ${seconds} seconds.`);
      }
      if (!response.ok)
        throw new Error(
          response.status >= 500
            ? 'Service unavailable. Please retry.'
            : 'Unable to sign in. Check your username and password.'
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
    } catch (error) {
      locked.current = false;
      setPending(false);
      setError('password', {
        type: 'server',
        message:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'The request timed out. Please retry.'
            : error instanceof Error && error.name !== 'TypeError'
              ? error.message
              : 'Service unavailable. Please retry.'
      });
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm border border-border rounded-lg p-8 bg-surface">
        {/* Header */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-10 h-10 bg-brand-light rounded-lg flex items-center justify-center mb-3">
            <Hotel className="w-5 h-5 text-ink" />
          </div>
          <h1 className="font-medium text-[22px] text-brand">Manager Dashboard</h1>
          <p className="font-normal text-xs text-muted mt-1">Sign in to access your administrative workspace.</p>
        </div>

        {expired && (
          <p role="status" className="font-normal text-xs text-muted mb-4">
            Your session ended. Please sign in again.
          </p>
        )}
        <form
          noValidate
          onSubmit={event => {
            void handleSubmit(onSubmit)(event);
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <label className="font-normal text-xs text-muted block mb-1" htmlFor="username">
              Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-4 w-4 text-muted" />
              </div>
              <input
                id="username"
                type="text"
                autoComplete="username"
                aria-invalid={!!errors.username}
                aria-describedby={errors.username ? 'username-error' : undefined}
                placeholder="manager"
                className="w-full border border-border rounded-md pl-9 pr-3 py-2 text-[13px] text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand"
                {...register('username')}
              />
            </div>
            {errors.username && (
              <p id="username-error" role="alert" className="font-normal text-xs text-danger mt-1">
                {errors.username.message}
              </p>
            )}
          </div>

          <div>
            <label className="font-normal text-xs text-muted block mb-1" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-muted" />
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
                placeholder="••••••••"
                className="w-full border border-border rounded-md pl-9 pr-3 py-2 text-[13px] text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand"
                {...register('password')}
              />
            </div>
            {errors.password && (
              <p id="password-error" role="alert" className="font-normal text-xs text-danger mt-1">
                {errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || pending}
            className="w-full bg-brand text-white rounded-md py-2 mt-2 font-medium text-[13px] flex items-center justify-center gap-2 disabled:opacity-50 button button-primary"
          >
            {isSubmitting || pending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                Sign in
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>
        <Link href="/reset-password" className="mt-4 block text-center text-sm text-brand underline" prefetch={false}>
          Reset manager password
        </Link>
      </div>
    </div>
  );
}
