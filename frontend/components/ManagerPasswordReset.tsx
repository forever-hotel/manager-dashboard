'use client';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
export function ManagerPasswordReset() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [stage, setStage] = useState<'email' | 'code' | 'done'>('email');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    setError('');
    setMessage('');
    if (
      stage === 'code' &&
      (!/^[0-9]{6}$/.test(code) ||
        password.length < 12 ||
        password.length > 1024 ||
        !/\S/.test(password) ||
        password !== confirmation)
    ) {
      setError('Enter the six-digit code and matching passwords of 12 to 1024 characters.');
      return;
    }
    locked.current = true;
    setPending(true);
    try {
      const response = await fetch('/api/auth/' + (stage === 'email' ? 'request-password-reset' : 'reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify(
          stage === 'email' ? { email: email.trim() } : { email: email.trim(), code, newPassword: password }
        )
      });
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('message' in body) || typeof body.message !== 'string')
        throw new Error('Service unavailable. Please retry.');
      if (!response.ok) throw new Error(body.message);
      setMessage(body.message);
      setStage(stage === 'email' ? 'code' : 'done');
      setPassword('');
      setConfirmation('');
    } catch (error) {
      setError(
        error instanceof Error && error.name !== 'TypeError' ? error.message : 'Service unavailable. Please retry.'
      );
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <section className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <h1 className="text-[22px] font-medium text-brand">Reset manager password</h1>
        <p className="my-4 text-sm text-muted">
          Request a code sent to your manager email. Your new password must differ from your current password.
        </p>
        {error && (
          <p role="alert" className="mb-4 text-sm text-danger">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mb-4 text-sm text-success">
            {message}
          </p>
        )}
        {stage !== 'done' && (
          <form
            onSubmit={event => {
              void submit(event);
            }}
            className="flex flex-col gap-4"
          >
            <label className="text-sm">
              Manager email
              <input
                className="mt-1 w-full rounded-md border border-border p-2"
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                value={email}
                readOnly={stage === 'code'}
                onChange={event => setEmail(event.target.value)}
              />
            </label>
            {stage === 'code' && (
              <>
                <label className="text-sm">
                  Email verification code
                  <input
                    className="mt-1 w-full rounded-md border border-border p-2"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={event => setCode(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  New password
                  <input
                    className="mt-1 w-full rounded-md border border-border p-2"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={1024}
                    required
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Confirm new password
                  <input
                    className="mt-1 w-full rounded-md border border-border p-2"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={1024}
                    required
                    value={confirmation}
                    onChange={event => setConfirmation(event.target.value)}
                  />
                </label>
              </>
            )}
            <button className="button button-primary" disabled={pending}>
              {pending ? 'Please wait...' : stage === 'email' ? 'Send verification code' : 'Change password'}
            </button>
            {stage === 'code' && (
              <button
                className="button button-secondary"
                type="button"
                disabled={pending}
                onClick={() => {
                  setStage('email');
                  setCode('');
                  setPassword('');
                  setConfirmation('');
                  setError('');
                  setMessage('');
                }}
              >
                Request another code
              </button>
            )}
          </form>
        )}
        <Link className="mt-4 block text-sm text-brand underline" href="/login" prefetch={false}>
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
