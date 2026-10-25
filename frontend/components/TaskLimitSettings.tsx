'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { taskLimitInput, taskLimitSchema, type TaskLimit } from '@/lib/task-limit';
const button =
  'rounded border border-gray-200 px-3 py-2 text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';
export default function TaskLimitSettings() {
  const [data, setData] = useState<TaskLimit>();
  const [draft, setDraft] = useState('');
  const [version, setVersion] = useState<number>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);
  const dirty = useRef(false),
    locked = useRef(false),
    accessDenied = useRef(false),
    generation = useRef(0),
    mounted = useRef(false);
  const refresh = useCallback(async (rebase = false) => {
    if (accessDenied.current) return;
    const current = ++generation.current;
    try {
      const response = await fetch('/api/settings/task-limit', {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000)
      });
      if (!mounted.current || generation.current !== current) return;
      if (response.status === 401 || response.status === 403) {
        accessDenied.current = true;
        setDenied(true);
        setData(undefined);
        throw new Error('Please sign in with manager access.');
      }
      if (!response.ok) throw new Error('Settings are unavailable. Retry to confirm the current policy.');
      const next = taskLimitSchema.parse(await response.json());
      if (!mounted.current || generation.current !== current) return;
      setData(next);
      if (rebase || !dirty.current) setError('');
      setNotice(current =>
        next.status === 'EFFECTIVE' && current.startsWith('Saved.') ? 'WKMS has confirmed this policy.' : current
      );
      if (rebase || !dirty.current) {
        setVersion(next.version);
        if (!dirty.current) setDraft(String(next.limit));
      }
    } catch (e) {
      if (mounted.current && generation.current === current)
        setError(e instanceof Error ? e.message : 'Settings are unavailable.');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => {
      void refresh();
    }, 0);
    const timer = setInterval(() => {
      if (!locked.current && !accessDenied.current) void refresh();
    }, 10000);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || denied || accessDenied.current) return;
    const parsed = taskLimitInput.safeParse({
      limit: /^\d+$/.test(draft) ? Number(draft) : NaN,
      version
    });
    if (!parsed.success) {
      setError('Enter a whole number from 1 to 10 and load a current policy version.');
      return;
    }
    locked.current = true;
    generation.current++;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/settings/task-limit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(8000)
      });
      if (!mounted.current) return;
      if (response.status === 401 || response.status === 403) {
        accessDenied.current = true;
        setDenied(true);
        setData(undefined);
        throw new Error('Please sign in with manager access.');
      }
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? 'Policy changed. Reload the current version, review your draft and save again.'
            : 'Save could not be confirmed. Refresh before retrying; it may already have completed.'
        );
      const next = taskLimitSchema.parse(await response.json());
      if (!mounted.current) return;
      setData(next);
      setVersion(next.version);
      setDraft(String(next.limit));
      dirty.current = false;
      setNotice(
        next.status === 'EFFECTIVE'
          ? 'WKMS has confirmed this policy.'
          : 'Saved. Waiting for WKMS confirmation; the previous effective policy still applies.'
      );
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Save could not be confirmed.');
    } finally {
      locked.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
      <h1 className="mb-6 text-[15px] font-medium text-black">Settings</h1>
      <section className="rounded-lg border border-gray-200 p-5 text-[11px]" aria-labelledby="task-limit-title">
        <h2 id="task-limit-title" className="text-[12px] font-medium text-black">
          Worker active-task limit
        </h2>
        <p className="mt-2 text-black/60">
          Default 3; allowed range 1–10. Assigned, In Progress and Escalated tasks count when assigned to a worker.
          Existing tasks are retained when the limit is reduced.
        </p>
        {error && (
          <p role="alert" className="mt-3">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3">
            {notice}
          </p>
        )}
        {!data && !error && <p role="status">Loading task-limit policy…</p>}
        {data && (
          <div className="my-4" aria-live="polite">
            <p>
              Requested limit: {data.limit} (version {data.version})
            </p>
            <p>
              WKMS-confirmed limit: {data.effectiveLimit === null ? 'Not confirmed' : data.effectiveLimit}{' '}
              {data.effectiveVersion !== null && `(version ${data.effectiveVersion})`}
            </p>
            <p>
              {data.status === 'EFFECTIVE'
                ? 'Effective — confirmed by WKMS.'
                : 'Pending WKMS confirmation. Saving in MAD alone does not activate a policy.'}
            </p>
            {data.confirmedAt && (
              <p>
                Confirmed:{' '}
                {new Date(data.confirmedAt).toLocaleString('en-GB', {
                  timeZone: 'Asia/Colombo'
                })}{' '}
                · Asia/Colombo
              </p>
            )}
          </div>
        )}
        {!denied && (
          <form onSubmit={event => void save(event)} className="mt-4 flex flex-wrap items-end gap-3">
            <label>
              Maximum active tasks per worker
              <input
                className="mt-1 block w-40 rounded-md border border-gray-200 px-3 py-2"
                type="number"
                min={1}
                max={10}
                step={1}
                value={draft}
                disabled={saving || version === undefined}
                onChange={e => {
                  dirty.current = true;
                  setDraft(e.target.value);
                }}
                required
              />
            </label>
            <button className={button} disabled={saving || version === undefined} type="submit">
              {saving ? 'Saving…' : 'Save task limit'}
            </button>
          </form>
        )}
        <button
          type="button"
          className={button + ' mt-4'}
          disabled={saving || denied}
          onClick={() => void refresh(true)}
        >
          Reload current version
        </button>
      </section>
    </main>
  );
}
