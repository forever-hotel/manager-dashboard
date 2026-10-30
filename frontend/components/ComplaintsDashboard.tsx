'use client';

import Pagination from './Pagination';
import RowActions from '@/components/RowActions';
import { PageHeader, SummaryCard } from './DashboardVisuals';
import AnalyticsPeriodNavigation from './AnalyticsPeriodNavigation';
import { hotelDate } from '@/lib/analytics-period';
import type { Period } from '@/lib/analytics';
import { statusColor } from '@/lib/status-color';
import { useEffect, useRef, useState } from 'react';
import {
  COMPLAINT_CHANGED_EVENT,
  ComplaintError,
  complaintDetailSchema,
  complaintPageSchema,
  complaintPatchSchema,
  complaintRequest,
  complaintSchema,
  nextStatus,
  statusLabel,
  type Complaint,
  type ComplaintDetail
} from '@/lib/complaints';

const button = 'font-normal text-xs text-ink underline';
const control = 'w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink';
const formatDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' });
const errorText = (e: unknown) =>
  e instanceof ComplaintError
    ? e.message
    : 'Service unavailable. Reload before retrying; a save may already have completed.';

export default function ComplaintsDashboard({
  initialWorkerId = '',
  initialStatus = '',
  initialComplaintId
}: {
  initialWorkerId?: string;
  initialStatus?: string;
  initialComplaintId?: string;
} = {}) {
  const [rows, setRows] = useState<Complaint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<Period>('week');
  const [selectedDate, setSelectedDate] = useState(() => hotelDate());
  const [filters] = useState({
    status: initialStatus,
    category: '',
    workerId: initialWorkerId
  });
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<{
    open: number;
    review: number;
    resolved: number;
    averageMinutes: number | null;
  }>();
  const [selectedId, setSelectedId] = useState<string | undefined>(initialComplaintId);
  const [detail, setDetail] = useState<ComplaintDetail>();
  const [detailLoading, setDetailLoading] = useState(Boolean(initialComplaintId));
  const [detailError, setDetailError] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const panel = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const detailController = useRef<AbortController | null>(null);

  useEffect(() => () => detailController.current?.abort(), []);
  useEffect(() => {
    if (!selectedId) return;
    const dialog = panel.current;
    const previous = document.activeElement;

    dialog?.showModal();
    dialog?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [selectedId]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const query = new URLSearchParams({ page: String(page), pageSize: '20', period, date: selectedDate });

    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    complaintRequest('?' + query, complaintPageSchema, 'GET', undefined, controller.signal)
      .then(data => {
        if (active) {
          setCounts(data.summary);
          setRows(data.items);
          setTotal(data.total);
          if (!data.items.length && page > 1) setPage(Math.max(1, Math.ceil(data.total / 20)));
        }
      })
      .catch(e => {
        if (active) {
          setRows([]);
          setError(errorText(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, page, refresh, period, selectedDate]);
  function reloadList() {
    setError('');
    setLoading(true);
    setCounts(undefined);
    setRefresh(v => v + 1);
  }
  async function loadDetail(id: string) {
    detailController.current?.abort();
    const controller = new AbortController();

    detailController.current = controller;
    setDetailLoading(true);
    setDetailError('');
    try {
      const value = await complaintRequest('/' + id, complaintDetailSchema, 'GET', undefined, controller.signal);

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
  useEffect(() => {
    if (!initialComplaintId) return;
    const controller = new AbortController();

    detailController.current = controller;
    void complaintRequest('/' + initialComplaintId, complaintDetailSchema, 'GET', undefined, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch(error => {
        if (!controller.signal.aborted) setDetailError(errorText(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [initialComplaintId]);
  function open(row: Complaint, element: HTMLButtonElement) {
    if (note && !window.confirm('Discard the unsaved note and open another complaint?')) return;
    opener.current = element;
    setSelectedId(row.id);
    setDetail(undefined);
    setNote('');
    setNotice('');
    setConflict(false);
    void loadDetail(row.id);
  }
  function dismissAction() {
    detailController.current?.abort();
    setSelectedId(undefined);
    setDetail(undefined);
    setDetailLoading(false);
    setDetailError('');
    setConflict(false);
    setNote('');
  }
  function close() {
    if (saving || (note && !window.confirm('Discard the unsaved note?'))) return;
    dismissAction();
    const target = document.getElementById('complaint-open-' + selectedId);

    if (target) target.focus();
    else if (opener.current?.isConnected) opener.current.focus();
    else document.getElementById('complaint-period')?.focus();
  }
  async function save() {
    if (!detail || conflict || detailLoading || lock.current) return;
    const parsed = complaintPatchSchema.safeParse({
      version: detail.version,
      status: nextStatus(detail.status),
      note
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
      const saved = await complaintRequest('/' + detail.id, complaintSchema, 'PATCH', parsed.data);

      dismissAction();
      setNotice(`Saved: ${statusLabel[saved.status]}.`);
      window.dispatchEvent(
        new CustomEvent(COMPLAINT_CHANGED_EVENT, {
          detail: {
            id: saved.id,
            status: saved.status,
            version: saved.version
          }
        })
      );
      reloadList();
      document.getElementById('complaint-period')?.focus();
    } catch (e) {
      setDetailError(errorText(e));
      if (e instanceof ComplaintError && e.status === 409) setConflict(true);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <main className="dashboard-page">
      <PageHeader
        title="Complaints"
        period={period}
        onPeriodChange={value => {
          dismissAction();
          setNotice('');
          setPeriod(value);
          setPage(1);
          setLoading(true);
          setError('');
          setCounts(undefined);
        }}
      />
      <div id="complaint-period" tabIndex={-1}>
        <AnalyticsPeriodNavigation
          period={period}
          date={selectedDate}
          scope="complaints"
          onChange={value => {
            dismissAction();
            setNotice('');
            setSelectedDate(value);
            setPage(1);
            setLoading(true);
            setError('');
            setCounts(undefined);
          }}
        />
      </div>
      <section className="mb-6">
        <h2 className="section-eyebrow">Complaint register</h2>
        <div className="summary-grid">
          <SummaryCard
            label="Open complaints"
            value={counts ? String(counts.open) : '\u2014'}
            tone="danger"
            title="Submitted complaints in the selected period."
          />
          <SummaryCard
            label="Under review"
            value={counts ? String(counts.review) : '\u2014'}
            tone="warning"
            title="Complaints submitted in the selected period, currently under review."
          />
          <SummaryCard
            label={'Resolved (' + period + ')'}
            value={counts ? String(counts.resolved) : '\u2014'}
            tone="success"
            title="Complaints resolved in the selected period, regardless of submission date."
          />
          <SummaryCard
            label="Avg resolution"
            value={
              counts?.averageMinutes == null
                ? '\u2014'
                : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(
                    counts.averageMinutes >= 60 ? counts.averageMinutes / 60 : counts.averageMinutes
                  ) + (counts.averageMinutes >= 60 ? ' hrs' : ' min')
            }
            title="Submission to resolution for complaints resolved in the selected period. Invalid durations are excluded."
          />
        </div>
      </section>
      {notice && (
        <p role="status" className="complaint-save-notice">
          {notice}
        </p>
      )}
      <p className="page-note">
        Submitted → Review → Under review → Resolve → Resolved. Each update requires an internal note.
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-danger mb-3">
          {error}{' '}
          <button type="button" className="button button-ghost" onClick={reloadList}>
            Retry complaints
          </button>
        </p>
      )}
      {/* Table */}
      <section className="register-section mb-10">
        <h2 className="mb-3 font-medium text-base text-ink">Complaint register</h2>
        <div
          className="border border-border rounded-lg overflow-x-auto bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Complaint register data"
        >
          <table className="w-full text-left border-collapse dashboard-table">
            <caption className="sr-only">Complaints matching current filters</caption>
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                {['ID', 'Room', 'Category', 'Severity', 'Submitted', 'Worker ref', 'Status', 'Action'].map(h => (
                  <th key={h} className="font-medium text-xs text-ink px-3 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} role="status" className="text-xs text-ink px-3 py-3">
                    Loading complaints...
                  </td>
                </tr>
              )}
              {!loading && !rows.length && !error && (
                <tr>
                  <td colSpan={8} className="text-xs text-ink px-3 py-3">
                    No complaints match these filters.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row, i, arr) => (
                  <tr key={row.id} className={i < arr.length - 1 ? 'border-b border-border' : ''}>
                    <td className="text-xs text-ink px-3 py-3">
                      {row.id}
                      <p className="font-normal text-xs text-muted whitespace-pre-wrap">{row.description}</p>
                    </td>
                    <td className="text-xs text-ink px-3 py-3">{row.roomNumber}</td>
                    <td className="text-xs text-ink px-3 py-3">{row.category}</td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          'status-badge ' +
                          (row.severity === 'HIGH'
                            ? 'bg-danger-light text-danger'
                            : row.severity === 'MEDIUM'
                              ? 'bg-warning-light text-warning'
                              : 'bg-brand-light text-brand')
                        }
                      >
                        {row.severity.toLowerCase()}
                      </span>
                    </td>
                    <td className="text-xs text-ink px-3 py-3">{formatDate(row.submittedAt)}</td>
                    <td className="text-xs text-ink px-3 py-3">
                      {row.workerName ?? row.referencedWorkerId ?? 'No worker referenced'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={'status-badge ' + statusColor(row.status)}>{statusLabel[row.status]}</span>
                    </td>
                    <td className="px-3 py-3">
                      <RowActions
                        label={'Actions for complaint ' + row.id}
                        triggerId={'complaint-open-' + row.id}
                        disabled={saving}
                      >
                        <button
                          disabled={saving}
                          onClick={e => open(row, e.currentTarget)}
                          aria-label={`View complaint ${row.id}`}
                          className={'button ' + (row.status === 'RESOLVED' ? 'button-secondary' : 'button-primary')}
                        >
                          {row.status === 'SUBMITTED' ? 'Review' : row.status === 'UNDER_REVIEW' ? 'Resolve' : 'View'}
                        </button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={20}
          total={total}
          noun="complaints"
          disabled={saving || loading}
          onChange={value => {
            setLoading(true);
            setError('');
            setPage(value);
          }}
        />
      </section>
      {selectedId && (
        <dialog
          ref={panel}
          tabIndex={-1}
          aria-labelledby="complaint-detail-heading"
          aria-busy={detailLoading || saving}
          onCancel={event => {
            event.preventDefault();
            close();
          }}
          className="success-dialog complaint-dialog"
        >
          <div className="flex justify-between mb-3">
            <h2 id="complaint-detail-heading" className="font-medium text-base text-ink">
              Complaint details
            </h2>
            <button disabled={saving} onClick={close} className={button + ' button button-secondary'}>
              Close details
            </button>
          </div>
          <p className="text-xs text-ink">{selectedId}</p>
          {detailLoading && (
            <p role="status" className="text-[13px] text-ink">
              Loading complaint details...
            </p>
          )}
          {detailError && (
            <p id="complaint-note-error" role="alert" className="text-[13px] text-danger">
              {detailError}
            </p>
          )}
          <button
            disabled={saving || detailLoading}
            onClick={() => {
              setNotice('');
              void loadDetail(selectedId);
            }}
            className={button + ' button button-secondary'}
          >
            Reload latest version (keep note)
          </button>
          {detail && (
            <>
              <ol className="complaint-workflow" aria-label="Complaint status progress">
                {(['SUBMITTED', 'UNDER_REVIEW', 'RESOLVED'] as const).map(status => (
                  <li
                    key={status}
                    aria-current={detail.status === status ? 'step' : undefined}
                    className={'status-badge ' + statusColor(status)}
                  >
                    {statusLabel[status]}
                  </li>
                ))}
              </ol>
              <dl className="complaint-detail-grid text-[13px] text-ink mb-4">
                <dt>Room</dt>
                <dd>{detail.roomNumber}</dd>
                <dt>Category</dt>
                <dd>{detail.category}</dd>
                <dt>Guest description</dt>
                <dd className="whitespace-pre-wrap">{detail.description}</dd>
                <dt>Worker reference</dt>
                <dd>{detail.workerName ?? detail.referencedWorkerId ?? 'No worker referenced'}</dd>
                <dt>Submitted</dt>
                <dd>{formatDate(detail.submittedAt)}</dd>
                <dt>Status</dt>
                <dd>{statusLabel[detail.status]}</dd>
                <dt>Version</dt>
                <dd>{detail.version}</dd>
                {detail.resolvedAt && (
                  <>
                    <dt>Resolved</dt>
                    <dd>{formatDate(detail.resolvedAt)}</dd>
                  </>
                )}
              </dl>
              <h3 className="font-medium text-[13px] text-ink mb-3">Internal resolution history</h3>
              {!detail.history.length && <p className="text-[13px] text-muted">No recorded resolution notes.</p>}
              <ol>
                {detail.history.map(entry => (
                  <li key={entry.version} className="text-[13px] text-ink border-b border-border py-2">
                    <p>
                      {statusLabel[entry.fromStatus]} to {statusLabel[entry.status]} / {formatDate(entry.recordedAt)} /
                      Manager {entry.actorId}
                    </p>
                    <p className="whitespace-pre-wrap">{entry.note}</p>
                  </li>
                ))}
              </ol>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  void save();
                }}
                className="mt-4"
              >
                <p className="text-[13px] text-ink mb-3">
                  {nextStatus(detail.status)
                    ? `Next status: ${statusLabel[nextStatus(detail.status)!]}`
                    : 'Resolved complaints cannot be reopened.'}
                </p>
                <label htmlFor="complaint-note" className="font-normal text-xs text-muted block mb-1">
                  Internal note (manager only)
                </label>
                <textarea
                  id="complaint-note"
                  className={control}
                  value={note}
                  maxLength={4000}
                  rows={4}
                  disabled={saving || detail.status === 'RESOLVED'}
                  aria-describedby={detailError ? 'complaint-note-error' : undefined}
                  onChange={e => {
                    setNote(e.target.value);
                    setNotice('');
                  }}
                />
                <button
                  type="submit"
                  disabled={saving || detailLoading || conflict || !nextStatus(detail.status)}
                  className="font-normal text-[13px] text-ink bg-brand-light rounded-md px-4 py-2 mt-3 button button-primary"
                >
                  {saving
                    ? 'Saving...'
                    : detail.status === 'SUBMITTED'
                      ? 'Move to under review'
                      : detail.status === 'UNDER_REVIEW'
                        ? 'Resolve complaint'
                        : 'Complaint resolved'}
                </button>
              </form>
            </>
          )}
        </dialog>
      )}
    </main>
  );
}
