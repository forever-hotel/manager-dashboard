'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { statusColor } from '@/lib/status-color';
import { Staff, staffDetail, staffInput, staffLabels, staffPage, staffRoles } from '@/lib/staff';
const empty = {
  name: '',
  role: 'RECEPTIONIST',
  vocation: '',
  email: '',
  phone: '',
  nic: '',
  age: ''
};
const messages: Record<number, string> = {
  400: 'Check the required fields and their formats.',
  401: 'Please sign in again.',
  403: 'Manager access is required.',
  404: 'This staff account is no longer available.',
  409: 'The account changed or these unique details already exist. Check the email/NIC or reload the current version before retrying.',
  503: 'Service unavailable. Refresh the directory to check whether the operation completed before retrying.'
};
export default function StaffAccounts() {
  const [form, setForm] = useState({ ...empty });
  const [editing, setEditing] = useState<Staff | null>(null);
  const [rows, setRows] = useState<Staff[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{
    staff: Staff;
    action: 'reset' | 'deactivate';
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!confirm) return;
    const previous = document.activeElement;
    confirmationRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [confirm]);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '20',
    ...(search ? { search } : {}),
    ...(role ? { role } : {}),
    ...(status ? { status } : {})
  }).toString();
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/staff?' + query, {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(messages[response.status] ?? messages[503]);
        const data = staffPage.parse(await response.json());
        if (!stopped) {
          setRows(data.items);
          setTotal(data.total);
          setListError('');
        }
      } catch (error) {
        if (!stopped) {
          setRows([]);
          setListError(
            error instanceof Error && Object.values(messages).includes(error.message) ? error.message : messages[503]
          );
        }
      } finally {
        if (!stopped) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [query, refresh]);
  const reload = useCallback(() => {
    setLoading(true);
    setRefresh(n => n + 1);
  }, []);
  function clear() {
    setEditing(null);
    setForm({ ...empty });
    setMessage('');
    nameRef.current?.focus();
  }
  async function select(staff: Staff) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/staff/' + staff.staffId, {
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(messages[response.status] ?? messages[503]);
      const current = staffDetail.parse(await response.json());
      setEditing(current);
      setForm({
        name: current.name,
        vocation: current.vocation,
        email: current.email,
        role: current.role,
        phone: current.phone ?? '',
        nic: current.nic ?? '',
        age: current.age === null ? '' : String(current.age)
      });
      nameRef.current?.focus();
    } catch (error) {
      setMessage(
        error instanceof Error && Object.values(messages).includes(error.message) ? error.message : messages[503]
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function mutate(path: string, method: string, body: unknown) {
    const response = await fetch('/api/staff' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(messages[response.status] ?? messages[503]);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const parsed = staffInput.safeParse({
      ...form,
      email: form.email.trim().toLowerCase(),
      age: form.age === '' ? NaN : Number(form.age)
    });
    if (!parsed.success) {
      setMessage(
        'Check name, vocation, email, role, age (1?120), phone (7?15 digits, optional +) and NIC (12 digits or 9 digits followed by V/X).'
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await mutate(
        editing ? '/' + editing.staffId : '',
        editing ? 'PATCH' : 'POST',
        editing ? { ...parsed.data, version: editing.version } : parsed.data
      );
      clear();
      setMessage(
        editing
          ? 'Profile saved. Existing sessions were invalidated.'
          : 'Account created. Credentials are queued for email delivery.'
      );
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages[503]);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function action() {
    if (!confirm || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await mutate(
        '/' + confirm.staff.staffId + (confirm.action === 'reset' ? '/reset-password' : ''),
        confirm.action === 'reset' ? 'POST' : 'PATCH',
        {
          version: confirm.staff.version,
          ...(confirm.action === 'deactivate' ? { isActive: false } : {})
        }
      );
      setMessage(
        confirm.action === 'reset'
          ? 'Password reset queued for email delivery. Previous sessions are invalidated.'
          : 'Staff account deactivated.'
      );
      setConfirm(null);
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages[503]);
      setConfirm(null);
      reload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function rebase() {
    if (!editing || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/staff/' + editing.staffId, {
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(messages[response.status] ?? messages[503]);
      const current = staffDetail.parse(await response.json());
      setEditing(current);
      setMessage(
        'Current version loaded. Your draft is retained. Review the latest profile shown below before saving.'
      );
      reload();
    } catch {
      setMessage(messages[503]);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[22px] text-brand">Staff accounts</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-brand-light rounded-md p-1">
            <button
              type="button"
              disabled
              title="Staff directory shows current accounts"
              className="font-normal text-xs text-ink px-3 py-1 rounded button button-secondary"
            >
              Day
            </button>
            <button
              type="button"
              disabled
              title="Staff directory shows current accounts"
              className="font-medium text-xs text-ink px-3 py-1 rounded bg-surface shadow-sm button button-secondary"
            >
              Week
            </button>
            <button
              type="button"
              disabled
              title="Staff directory shows current accounts"
              className="font-normal text-xs text-ink px-3 py-1 rounded button button-secondary"
            >
              Month
            </button>
          </div>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>

      {message && (
        <p role="alert" className="font-normal text-[13px] text-ink mb-4">
          {message}
        </p>
      )}
      <section className="mb-8">
        <h2 className="underline mb-3 font-medium text-base text-ink">Staff account management</h2>
        <form onSubmit={save} className="border border-border rounded-lg p-5">
          <h3 className="font-medium text-[13px] text-ink mb-4">
            {editing ? 'Edit staff account' : 'Create staff account'}
          </h3>
          {editing && (
            <div className="font-normal text-xs text-ink mb-4">
              Current profile: {editing.name}, {editing.email}, {staffLabels[editing.role]}, {editing.vocation}, age{' '}
              {editing.age ?? 'unknown'}, phone {editing.phone ?? 'unknown'}, NIC {editing.nic ?? 'unknown'}. Version{' '}
              {editing.version}.{' '}
              <button
                type="button"
                disabled={busy}
                className="underline button button-ghost"
                onClick={() => void rebase()}
              >
                Reload current version and keep draft
              </button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4 mb-4">
            {(['name', 'role', 'vocation', 'email', 'phone', 'nic', 'age'] as const).map(key => (
              <div key={key}>
                <label htmlFor={'staff-' + key} className="font-normal text-xs text-muted block mb-1">
                  {
                    {
                      name: 'Full name',
                      role: 'Role',
                      vocation: 'Vocation',
                      email: 'Email',
                      phone: 'Phone',
                      nic: 'NIC',
                      age: 'Age'
                    }[key]
                  }
                </label>
                {key === 'role' ? (
                  <select
                    id="staff-role"
                    disabled={busy}
                    value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value })}
                    className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                  >
                    {staffRoles.map(r => (
                      <option key={r} value={r}>
                        {staffLabels[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    ref={key === 'name' ? nameRef : undefined}
                    id={'staff-' + key}
                    required
                    disabled={busy}
                    type={key === 'age' ? 'number' : key === 'email' ? 'email' : 'text'}
                    min={key === 'age' ? 1 : undefined}
                    max={key === 'age' ? 120 : undefined}
                    value={form[key]}
                    onChange={e => setForm({ ...form, [key]: e.target.value })}
                    className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="bg-surface-alt rounded-md px-3 py-3 mb-5">
            <span className="font-normal text-xs text-ink">
              Username and temporary password are generated and emailed when delivery is enabled. Passwords are never
              displayed here.
            </span>
          </div>
          <div className="flex gap-3">
            <button
              disabled={busy}
              className="font-normal text-[13px] text-ink bg-brand-light rounded-md px-4 py-2 button button-primary"
            >
              {busy ? 'Saving?' : editing ? 'Save changes' : 'Create account'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={clear}
              className="font-normal text-[13px] text-ink border border-border rounded-md px-4 py-2 button button-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
      {confirm && (
        <section
          ref={confirmationRef}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="staff-confirm-title"
          aria-describedby="staff-confirm-description"
          onKeyDown={event => {
            if (event.key === 'Escape' && !busy) {
              event.preventDefault();
              setConfirm(null);
            }
          }}
          className="border border-border rounded-lg p-5 mb-4 bg-surface"
        >
          <h2 id="staff-confirm-title" className="font-medium text-base text-ink">
            {confirm.action === 'reset' ? 'Reset password' : 'Deactivate account'} for {confirm.staff.name}?
          </h2>
          <p id="staff-confirm-description" className="font-normal text-[13px] my-3">
            {confirm.action === 'reset'
              ? 'This invalidates existing sessions and emails new temporary credentials.'
              : 'This blocks access and invalidates existing sessions.'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void action()}
            className="font-normal text-[13px] bg-brand-light rounded-md px-4 py-2 button button-danger"
          >
            Confirm {confirm.action === 'reset' ? 'reset' : 'deactivation'}
          </button>{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm(null)}
            className="font-normal text-[13px] border border-border rounded-md px-4 py-2 button button-secondary"
          >
            Keep account unchanged
          </button>
        </section>
      )}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-base text-ink">All staff accounts</h2>
          <button
            type="button"
            disabled={busy}
            onClick={clear}
            className="font-medium text-xs text-ink underline button button-primary"
          >
            + Add new
          </button>
        </div>
        <div className="flex gap-4 mb-3 font-normal text-[13px] text-ink">
          <label>
            Search
            <input
              maxLength={100}
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
                setLoading(true);
              }}
              className="block border border-border rounded-md px-3 py-2"
            />
          </label>
          <label>
            Filter role
            <select
              value={role}
              onChange={e => {
                setRole(e.target.value);
                setPage(1);
                setLoading(true);
              }}
              className="block border border-border rounded-md px-3 py-2"
            >
              <option value="">All roles</option>
              {staffRoles.map(r => (
                <option key={r} value={r}>
                  {staffLabels[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter status
            <select
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                setPage(1);
                setLoading(true);
              }}
              className="block border border-border rounded-md px-3 py-2"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <button type="button" onClick={reload} className="underline button button-ghost">
            Refresh directory
          </button>
        </div>
        {loading && (
          <p role="status" className="text-[13px]">
            Loading staff?
          </p>
        )}
        {listError && (
          <p role="status" className="text-[13px]">
            {listError} Use Refresh directory to retry.
          </p>
        )}
        <div
          className="border border-border rounded-lg overflow-x-auto bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Staff directory data"
        >
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">Staff accounts matching current filters</caption>
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                {['Name', 'Role', 'Email', 'Status', 'Last login', 'Delivery', 'Actions'].map(h => (
                  <th key={h} scope="col" className="font-medium text-xs text-ink px-3 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.staffId} className={i < rows.length - 1 ? 'border-b border-border' : ''}>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-brand-light flex items-center justify-center">
                        <span className="font-medium text-xs text-ink">
                          {s.name
                            .split(/\s+/)
                            .map(n => n[0])
                            .slice(0, 2)
                            .join('')}
                        </span>
                      </div>
                      <span className="font-normal text-xs text-ink">{s.name}</span>
                    </div>
                  </td>
                  <td className="text-xs text-ink px-3 py-3">{staffLabels[s.role]}</td>
                  <td className="text-xs text-ink px-3 py-3">{s.email}</td>
                  <td className="px-3 py-3">
                    <span className={'status-badge ' + statusColor(s.isActive ? 'ACTIVE' : 'INACTIVE')}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-xs text-ink px-3 py-3">Not recorded</td>
                  <td className="text-xs text-ink px-3 py-3">
                    {
                      {
                        pending: 'Queued for delivery',
                        sent: 'Email accepted by provider',
                        failed: 'Delivery failed; automatic retries are pending within the delivery window.',
                        cancelled:
                          'Delivery cancelled or expired; review the account before requesting a new password.',
                        none: 'No delivery record'
                      }[s.deliveryStatus]
                    }
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void select(s)}
                      className="font-normal text-xs text-ink underline button button-ghost"
                    >
                      Edit
                    </button>
                    {s.isActive && (
                      <>
                        {' ? '}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm({ staff: s, action: 'reset' })}
                          className="font-normal text-xs text-ink underline button button-ghost"
                        >
                          Reset pwd
                        </button>
                        {' ? '}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirm({ staff: s, action: 'deactivate' })}
                          className="font-normal text-xs text-ink underline button button-danger"
                        >
                          Deactivate
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !listError && rows.length === 0 && (
          <p className="text-[13px] my-3">No staff match these filters.</p>
        )}
        <div className="font-normal text-[13px] text-ink mt-3">
          Page {page} ? {total} accounts{' '}
          <button
            type="button"
            disabled={page === 1 || loading}
            onClick={() => {
              setPage(p => p - 1);
              setLoading(true);
            }}
            className="underline button button-ghost"
          >
            Previous
          </button>{' '}
          <button
            type="button"
            disabled={page * 20 >= total || loading}
            onClick={() => {
              setPage(p => p + 1);
              setLoading(true);
            }}
            className="underline button button-ghost"
          >
            Next
          </button>
        </div>
      </section>
    </main>
  );
}
