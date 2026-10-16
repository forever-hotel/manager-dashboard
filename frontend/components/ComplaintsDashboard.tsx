'use client';
import { useEffect, useRef, useState } from 'react';
import {
  COMPLAINT_CHANGED_EVENT,
  ComplaintError,
  complaintDetailSchema,
  complaintPageSchema,
  complaintPatchSchema,
  complaintQuerySchema,
  complaintRequest,
  complaintSchema,
  nextStatus,
  statusLabel,
  type Complaint,
  type ComplaintDetail,
} from '@/lib/complaints';
const button = 'font-normal text-[10px] text-black underline';
const control =
  'w-full border border-gray-200 rounded-md px-3 py-2 font-normal text-[11px] text-black';
const date = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' });
const errorText = (e: unknown) =>
  e instanceof ComplaintError
    ? e.message
    : 'Service unavailable. Reload before retrying; a save may already have completed.';
export default function ComplaintsDashboard() {
  const [rows, setRows] = useState<Complaint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    status: '',
    category: '',
    workerId: '',
  });
  const [draft, setDraft] = useState(filters);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<{ open: number; review: number }>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ComplaintDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const detailController = useRef<AbortController | null>(null);
  useEffect(() => () => detailController.current?.abort(), []);
  useEffect(() => {
    if (selectedId) panel.current?.focus();
  }, [selectedId]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    for (const [key, value] of Object.entries(filters))
      if (value) query.set(key, value);
    complaintRequest(
      '?' + query,
      complaintPageSchema,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (active) {
          setRows(data.items);
          setTotal(data.total);
          if (!data.items.length && page > 1)
            setPage(Math.max(1, Math.ceil(data.total / 20)));
        }
      })
      .catch((e) => {
        if (active) {
          setRows([]);
          setError(errorText(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    Promise.all(
      ['SUBMITTED', 'UNDER_REVIEW'].map((status) =>
        complaintRequest(
          `?status=${status}&pageSize=1`,
          complaintPageSchema,
          'GET',
          undefined,
          controller.signal,
        ),
      ),
    )
      .then(([submitted, review]) => {
        if (active)
          setCounts({
            open: submitted.total + review.total,
            review: review.total,
          });
      })
      .catch(() => {
        if (active) setCounts(undefined);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, page, refresh]);
  function reloadList() {
    setError('');
    setLoading(true);
    setCounts(undefined);
    setRefresh((v) => v + 1);
  }
  async function loadDetail(id: string) {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setDetailLoading(true);
    setDetailError('');
    try {
      const value = await complaintRequest(
        '/' + id,
        complaintDetailSchema,
        'GET',
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setDetail(value);
        setConflict(false);
      }
    } catch (e) {
      if (!controller.signal.aborted) setDetailError(errorText(e));
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }
  function open(row: Complaint, element: HTMLButtonElement) {
    if (
      note &&
      !window.confirm('Discard the unsaved note and open another complaint?')
    )
      return;
    opener.current = element;
    setSelectedId(row.id);
    setDetail(undefined);
    setNote('');
    setNotice('');
    setConflict(false);
    void loadDetail(row.id);
  }
  function close() {
    if (saving || (note && !window.confirm('Discard the unsaved note?')))
      return;
    detailController.current?.abort();
    setSelectedId(undefined);
    setDetail(undefined);
    setNote('');
    setNotice('');
    const target = document.getElementById('complaint-open-' + selectedId);
    if (target) target.focus();
    else if (opener.current?.isConnected) opener.current.focus();
    else document.getElementById('complaint-refresh')?.focus();
  }
  async function save() {
    if (!detail || conflict || detailLoading || lock.current) return;
    const parsed = complaintPatchSchema.safeParse({
      version: detail.version,
      status: nextStatus(detail.status),
      note,
    });
    if (!parsed.success) {
      setDetailError(parsed.error.issues[0].message);
      return;
    }
    lock.current = true;
    setSaving(true);
    setDetailError('');
    setNotice('');
    try {
      const saved = await complaintRequest(
        '/' + detail.id,
        complaintSchema,
        'PATCH',
        parsed.data,
      );
      setDetail({ ...detail, ...saved });
      setNote('');
      setNotice(`Saved: ${statusLabel[saved.status]}.`);
      window.dispatchEvent(
        new CustomEvent(COMPLAINT_CHANGED_EVENT, {
          detail: {
            id: saved.id,
            status: saved.status,
            version: saved.version,
          },
        }),
      );
      reloadList();
      await loadDetail(saved.id);
    } catch (e) {
      setDetailError(errorText(e));
      if (e instanceof ComplaintError && e.status === 409) setConflict(true);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Complaints</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
            <button
              disabled
              title="The complaint API lists all dates"
              className="font-normal text-[10.5px] text-black px-3 py-1 rounded"
            >
              Day
            </button>
            <button
              disabled
              title="The complaint API lists all dates"
              className="font-medium text-[10.5px] text-black px-3 py-1 rounded bg-white shadow-sm"
            >
              Week
            </button>
            <button
              disabled
              title="The complaint API lists all dates"
              className="font-normal text-[10.5px] text-black px-3 py-1 rounded"
            >
              Month
            </button>
          </div>
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="black"
            strokeWidth="1.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      </div>

      {/* Stats */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">
          Complaint register
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Open complaints
            </div>
            <div className="font-medium text-[19px] text-black">
              {counts?.open ?? 'Unavailable'}
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Under review
            </div>
            <div className="font-medium text-[19px] text-black">
              {counts?.review ?? 'Unavailable'}
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Resolved (month)
            </div>
            <div className="font-medium text-[19px] text-black">
              Unavailable
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Avg resolution
            </div>
            <div className="font-medium text-[19px] text-black">
              Unavailable
            </div>
          </div>
        </div>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = complaintQuerySchema.safeParse(
            Object.fromEntries(
              Object.entries(draft).filter(([, value]) => value.trim()),
            ),
          );
          if (!parsed.success) {
            setError(
              'Enter a valid worker UUID and a category of at most 100 characters.',
            );
            return;
          }
          setError('');
          setLoading(true);
          setCounts(undefined);
          setPage(1);
          setFilters({
            status: parsed.data.status ?? '',
            category: parsed.data.category ?? '',
            workerId: parsed.data.workerId ?? '',
          });
        }}
        className="grid grid-cols-3 gap-4 mb-4"
      >
        <label className="font-normal text-[10px] text-black/60">
          Status
          <select
            className={control}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="">All statuses</option>
            {Object.entries(statusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="font-normal text-[10px] text-black/60">
          Category (exact match)
          <input
            className={control}
            maxLength={100}
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        </label>
        <label className="font-normal text-[10px] text-black/60">
          Worker ID
          <input
            className={control}
            value={draft.workerId}
            onChange={(e) => setDraft({ ...draft, workerId: e.target.value })}
          />
        </label>
        <button type="submit" disabled={saving} className={button}>
          Search complaints
        </button>
        <button
          type="button"
          disabled={saving || loading}
          onClick={reloadList}
          id="complaint-refresh"
          className={button}
        >
          Refresh register
        </button>
      </form>
      <p className="font-normal text-[10px] text-black/60 mb-3">
        All dates; times shown in Asia/Colombo. Room, severity, monthly
        resolutions and average resolution time are not provided by this API.
      </p>
      {error && (
        <p role="alert" className="text-[11px] text-red-600 mb-3">
          {error}
        </p>
      )}
      {/* Table */}
      <section className="mb-10">
        <h2 className="font-medium text-[12px] text-black mb-3">
          Complaint register
        </h2>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {[
                  'ID',
                  'Room',
                  'Category',
                  'Severity',
                  'Submitted',
                  'Worker ref',
                  'Status',
                  'Action',
                ].map((h) => (
                  <th
                    key={h}
                    className="font-medium text-[10.5px] text-black px-3 py-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={8}
                    role="status"
                    className="text-[10.5px] text-black px-3 py-3"
                  >
                    Loading complaints...
                  </td>
                </tr>
              )}
              {!loading && !rows.length && !error && (
                <tr>
                  <td
                    colSpan={8}
                    className="text-[10.5px] text-black px-3 py-3"
                  >
                    No complaints match these filters.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row, i, arr) => (
                  <tr
                    key={row.id}
                    className={
                      i < arr.length - 1 ? 'border-b border-gray-100' : ''
                    }
                  >
                    <td className="text-[10.5px] text-black px-3 py-3">
                      {row.id}
                      <p className="font-normal text-[10px] text-black/60 whitespace-pre-wrap">
                        {row.description}
                      </p>
                    </td>
                    <td className="text-[10.5px] text-black px-3 py-3">
                      Not provided
                    </td>
                    <td className="text-[10.5px] text-black px-3 py-3">
                      {row.category}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-medium text-[9.5px] text-black bg-gray-100 rounded-full px-2 py-1">
                        Not provided
                      </span>
                    </td>
                    <td className="text-[10.5px] text-black px-3 py-3">
                      {date(row.submittedAt)}
                    </td>
                    <td className="text-[10.5px] text-black px-3 py-3">
                      {row.referencedWorkerId ?? 'No worker referenced'}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-medium text-[9.5px] text-black bg-gray-100 rounded-full px-2 py-1">
                        {statusLabel[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        disabled={saving}
                        onClick={(e) => open(row, e.currentTarget)}
                        id={`complaint-open-${row.id}`}
                        aria-label={`View complaint ${row.id}`}
                        className="font-normal text-[10px] text-black underline"
                      >
                        View / update
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="flex gap-3 mb-6">
        <button
          disabled={saving || loading || page <= 1}
          onClick={() => {
            setLoading(true);
            setError('');
            setPage(page - 1);
          }}
          className={button}
        >
          Previous page
        </button>
        <span className="text-[10.5px] text-black">
          Page {page} / {Math.max(1, Math.ceil(total / 20))}
        </span>
        <button
          disabled={saving || loading || page * 20 >= total}
          onClick={() => {
            setLoading(true);
            setError('');
            setPage(page + 1);
          }}
          className={button}
        >
          Next page
        </button>
      </div>
      {selectedId && (
        <section
          ref={panel}
          tabIndex={-1}
          aria-labelledby="complaint-detail-heading"
          aria-busy={detailLoading || saving}
          className="border border-gray-200 rounded-lg p-5 mb-8"
        >
          <div className="flex justify-between mb-3">
            <h2
              id="complaint-detail-heading"
              className="font-medium text-[12px] text-black"
            >
              Complaint details
            </h2>
            <button disabled={saving} onClick={close} className={button}>
              Close details
            </button>
          </div>
          <p className="text-[10.5px] text-black">{selectedId}</p>
          {detailLoading && (
            <p role="status" className="text-[11px] text-black">
              Loading complaint details...
            </p>
          )}
          {detailError && (
            <p
              id="complaint-note-error"
              role="alert"
              className="text-[11px] text-red-600"
            >
              {detailError}
            </p>
          )}
          {notice && (
            <p role="status" className="text-[11px] text-black">
              {notice}
            </p>
          )}
          <button
            disabled={saving || detailLoading}
            onClick={() => {
              setNotice('');
              void loadDetail(selectedId);
            }}
            className={button}
          >
            Reload latest version (keep note)
          </button>
          {detail && (
            <>
              <dl className="text-[11px] text-black mb-4">
                <dt>Category</dt>
                <dd>{detail.category}</dd>
                <dt>Guest description</dt>
                <dd className="whitespace-pre-wrap">{detail.description}</dd>
                <dt>Worker reference</dt>
                <dd>{detail.referencedWorkerId ?? 'No worker referenced'}</dd>
                <dt>Submitted</dt>
                <dd>{date(detail.submittedAt)}</dd>
                <dt>Status</dt>
                <dd>{statusLabel[detail.status]}</dd>
                <dt>Version</dt>
                <dd>{detail.version}</dd>
                {detail.resolvedAt && (
                  <>
                    <dt>Resolved</dt>
                    <dd>{date(detail.resolvedAt)}</dd>
                  </>
                )}
              </dl>
              <h3 className="font-medium text-[11.5px] text-black mb-3">
                Internal resolution history
              </h3>
              {!detail.history.length && (
                <p className="text-[11px] text-black/60">
                  No recorded resolution notes.
                </p>
              )}
              <ol>
                {detail.history.map((entry) => (
                  <li
                    key={entry.version}
                    className="text-[11px] text-black border-b border-gray-100 py-2"
                  >
                    <p>
                      {statusLabel[entry.fromStatus]} to{' '}
                      {statusLabel[entry.status]} / {date(entry.recordedAt)} /
                      Manager {entry.actorId}
                    </p>
                    <p className="whitespace-pre-wrap">{entry.note}</p>
                  </li>
                ))}
              </ol>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
                className="mt-4"
              >
                <p className="text-[11px] text-black mb-3">
                  {nextStatus(detail.status)
                    ? `Next status: ${statusLabel[nextStatus(detail.status)!]}`
                    : 'Resolved complaints cannot be reopened.'}
                </p>
                <label
                  htmlFor="complaint-note"
                  className="font-normal text-[10px] text-black/60 block mb-1"
                >
                  Internal note (manager only)
                </label>
                <textarea
                  id="complaint-note"
                  className={control}
                  value={note}
                  maxLength={4000}
                  rows={4}
                  disabled={saving}
                  aria-describedby={
                    detailError ? 'complaint-note-error' : undefined
                  }
                  onChange={(e) => {
                    setNote(e.target.value);
                    setNotice('');
                  }}
                />
                <button
                  type="submit"
                  disabled={
                    saving ||
                    detailLoading ||
                    conflict ||
                    !nextStatus(detail.status)
                  }
                  className="font-normal text-[11px] text-black bg-gray-100 rounded-md px-4 py-2 mt-3"
                >
                  {saving ? 'Saving...' : 'Save resolution update'}
                </button>
              </form>
            </>
          )}
        </section>
      )}
    </main>
  );
}
