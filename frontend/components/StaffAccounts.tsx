'use client';
import RowActions from '@/components/RowActions';
import SuccessDialog from '@/components/SuccessDialog';
import HeaderNotifications from '@/components/HeaderNotifications';
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
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{
    staff: Staff;
    action: 'activate' | 'deactivate' | 'delete';
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!confirm) return;
    const previous = document.activeElement;
    const dialog = confirmationRef.current;
    dialog?.showModal();
    dialog?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [confirm]);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '20'
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
      nameRef.current?.focus({ preventScroll: true });
      nameRef.current?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (!response.ok)
      throw new Error(
        method === 'DELETE' && response.status === 409
          ? 'This account has linked history or changed since loading. Reload it; if linked, deactivate it instead.'
          : (messages[response.status] ?? messages[503])
      );
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
        'Check name, vocation, email, role, age (1-120), phone (7-15 digits, optional +) and NIC (12 digits or 9 digits followed by V/X).'
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
      setSuccess(
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
      await mutate('/' + confirm.staff.staffId, confirm.action === 'delete' ? 'DELETE' : 'PATCH', {
        version: confirm.staff.version,
        ...(confirm.action !== 'delete' ? { isActive: confirm.action === 'activate' } : {})
      });
      setSuccess(
        confirm.action === 'delete'
          ? 'Staff account deleted.'
          : confirm.action === 'activate'
            ? 'Staff account activated.'
            : 'Staff account deactivated.'
      );
      if (editing?.staffId === confirm.staff.staffId) clear();
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
    <main className="dashboard-page">
      {/* Top bar */}
      <div className="page-topbar">
        <h1 className="font-medium text-[22px] text-brand">Staff accounts</h1>
        <div className="flex items-center gap-4">
          <HeaderNotifications />
        </div>
      </div>

      {message && (
        <p role="alert" className="font-normal text-[13px] text-danger mb-4">
          {message}
        </p>
      )}
      <section className="staff-create-form">
        <form onSubmit={save} className="staff-fields">
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
              <div key={key} className={key === 'age' ? 'staff-field-age' : undefined}>
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
                    placeholder={
                      {
                        name: 'Full name',
                        vocation: 'Vocation',
                        email: 'Email',
                        phone: 'Phone',
                        nic: 'NIC',
                        age: 'Age'
                      }[key]
                    }
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
          <div className="staff-delivery-note">
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
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Create account'}
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
        <dialog
          ref={confirmationRef}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          onCancel={event => {
            if (busy) event.preventDefault();
            else setConfirm(null);
          }}
          aria-labelledby="staff-confirm-title"
          aria-describedby="staff-confirm-description"
          onKeyDown={event => {
            if (event.key === 'Escape' && !busy) {
              event.preventDefault();
              setConfirm(null);
            }
          }}
          className="success-dialog"
        >
          <h2 id="staff-confirm-title" className="font-medium text-base text-ink">
            {confirm.action === 'delete' ? 'Delete' : confirm.action === 'activate' ? 'Activate' : 'Deactivate'} account
            for {confirm.staff.name}?
          </h2>
          <p id="staff-confirm-description" className="font-normal text-[13px] my-3">
            {confirm.action === 'delete'
              ? 'This permanently deletes an unused account. Accounts with linked history cannot be deleted; deactivate them instead.'
              : confirm.action === 'activate'
                ? 'This restores access using the existing password. Previous sessions remain invalid.'
                : 'This blocks access and invalidates existing sessions.'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void action()}
            className={
              'font-normal text-[13px] rounded-md px-4 py-2 button ' +
              (confirm.action === 'activate' ? 'button-primary' : 'button-danger')
            }
          >
            {confirm.action === 'delete'
              ? 'Confirm deletion'
              : confirm.action === 'activate'
                ? 'Confirm activation'
                : 'Confirm deactivation'}
          </button>{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm(null)}
            className="font-normal text-[13px] border border-border rounded-md px-4 py-2 button button-secondary"
          >
            Keep account unchanged
          </button>
        </dialog>
      )}
      <section className="register-section staff-register">
        <div className="staff-register-heading">
          <h2 className="font-medium text-base text-ink">All staff accounts</h2>
        </div>

        {loading && (
          <p role="status" className="text-[13px]">
            Loading staff...
          </p>
        )}
        {listError && (
          <p role="status" className="text-[13px]">
            {listError}{' '}
            <button type="button" onClick={reload} className="underline button button-ghost">
              Retry
            </button>
          </p>
        )}
        <div
          className="border border-border rounded-lg overflow-x-auto bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Staff directory data"
        >
          <table className="w-full text-left border-collapse dashboard-table">
            <caption className="sr-only">Staff accounts</caption>
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                {['Name', 'Role', 'Email', 'Status', 'Last login', 'Actions'].map(h => (
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
                  <td className="text-xs text-ink px-3 py-3" title="Last login is not recorded by this API">
                    &mdash;
                  </td>

                  <td className="px-3 py-3">
                    <RowActions label={'Actions for ' + s.name} disabled={busy}>
                      <button type="button" onClick={() => void select(s)}>
                        Edit
                      </button>
                      {s.isActive ? (
                        <button
                          type="button"
                          className="text-danger"
                          onClick={() => setConfirm({ staff: s, action: 'deactivate' })}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button type="button" onClick={() => setConfirm({ staff: s, action: 'activate' })}>
                          Activate
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-danger"
                        onClick={() => setConfirm({ staff: s, action: 'delete' })}
                      >
                        Delete account
                      </button>
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !listError && rows.length === 0 && <p className="text-[13px] my-3">No staff accounts found.</p>}
        <div className="font-normal text-[13px] text-ink mt-3">
          Page {page} &middot; {total} accounts{' '}
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
      <SuccessDialog message={success} onClose={() => setSuccess('')} />
    </main>
  );
}
