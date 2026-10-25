'use client';
import { useEffect, useRef, useState } from 'react';
import { statusColor } from '@/lib/status-color';
import { promotionDates } from '@/lib/low-demand';
import {
  createSchema,
  editSchema,
  emptyForm,
  formFrom,
  formPayload,
  pageSchema,
  promotionRequest,
  promotionSchema,
  publicationLabel,
  roomSchema,
  PromotionError,
  type Promotion,
  type PromotionForm,
  type RoomType
} from '@/lib/promotions';

export default function PromotionsDashboard({ initialDate }: { initialDate?: string } = {}) {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [form, setForm] = useState<PromotionForm>(() => ({
    ...emptyForm,
    ...promotionDates(initialDate)
  }));
  const [editing, setEditing] = useState<Promotion>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [roomsReady, setRoomsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const errorMessage = (e: unknown) =>
    e instanceof PromotionError
      ? e.message
      : 'Service unavailable. Refresh before retrying a save; it may already have succeeded.';
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const [result, options] = await Promise.all([
          promotionRequest(
            `?page=${page}&pageSize=20`,
            pageSchema(promotionSchema),
            'GET',
            undefined,
            controller.signal
          ),
          (async () => {
            const values: RoomType[] = [];
            let current = 1;
            while (true) {
              const part = await promotionRequest(
                `/room-types?page=${current}&pageSize=100`,
                pageSchema(roomSchema),
                'GET',
                undefined,
                controller.signal
              );
              values.push(...part.items);
              if (values.length >= part.total) return values;
              if (!part.items.length) throw new Error('Incomplete room types');
              current++;
            }
          })()
        ]);
        if (active) {
          setPromos(result.items);
          setTotal(result.total);
          setRooms(options);
          setRoomsReady(true);
          if (!result.items.length && page > 1) setPage(Math.max(1, Math.ceil(result.total / 20)));
        }
      } catch (e) {
        if (active) {
          setError(errorMessage(e));
          setPromos([]);
          setRoomsReady(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [page, refresh]);
  function reload() {
    setLoading(true);
    setError('');
    setRefresh(n => n + 1);
  }
  function field<K extends keyof PromotionForm>(key: K, value: PromotionForm[K]) {
    setForm(old => ({ ...old, [key]: value }));
    setErrors(old => ({ ...old, [key]: '' }));
  }
  async function work(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof PromotionError && e.status === 409) setConflict(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function save(status: 'ACTIVE' | 'INACTIVE') {
    if (editing && Number(form.maxRedemptions) < editing.currentRedemptions) {
      setErrors({
        maxRedemptions: 'Limit cannot be below completed redemptions.'
      });
      return;
    }
    const payload = formPayload(form);
    const parsed = editing
      ? editSchema.safeParse({ ...payload, version: editing.version })
      : createSchema.safeParse({ ...payload, status });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    if (!roomsReady || conflict) return;
    void work(async () => {
      const saved = await promotionRequest(
        editing ? '/' + editing.id : '',
        promotionSchema,
        editing ? 'PUT' : 'POST',
        parsed.data
      );
      setNotice(`Saved ${saved.code}. ${publicationLabel(saved.publicationStatus)}`);
      setEditing(undefined);
      setForm({ ...emptyForm });
      setErrors({});
      setConflict(false);
      reload();
    });
  }
  function edit(p: Promotion) {
    void work(async () => {
      const latest = await promotionRequest('/' + p.id, promotionSchema);
      if (latest.deletedAt) throw new PromotionError(404);
      setEditing(latest);
      setForm(formFrom(latest));
      setErrors({});
      setConflict(false);
    });
  }
  function recover() {
    if (!editing) {
      setConflict(false);
      reload();
      return;
    }
    void work(async () => {
      const latest = await promotionRequest('/' + editing.id, promotionSchema);
      if (latest.deletedAt) throw new PromotionError(404);
      setEditing(latest);
      setConflict(false);
      setNotice(
        `Latest version ${latest.version} loaded. Your entered values are preserved. Review them before saving over the latest version.`
      );
      reload();
    });
  }
  function action(p: Promotion, action: 'activate' | 'deactivate' | 'delete') {
    if (
      action !== 'activate' &&
      !window.confirm(
        `${action === 'delete' ? 'Delete' : 'Deactivate'} ${p.code}? ${action === 'delete' ? 'The code stays reserved and booking history is retained. This cannot be undone.' : 'This prevents future use after website synchronization.'}`
      )
    )
      return;
    void work(async () => {
      const saved = await promotionRequest(
        '/' + p.id + (action === 'delete' ? '' : '/' + action),
        promotionSchema,
        action === 'delete' ? 'DELETE' : 'POST',
        { version: p.version }
      );
      setNotice(`Saved ${saved.code}: ${saved.lifecycleState}. ${publicationLabel(saved.publicationStatus)}`);
      if (editing?.id === p.id) {
        setEditing(undefined);
        setForm({ ...emptyForm });
      }
      setConflict(false);
      reload();
    });
  }
  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`${name}-error`} role="alert" className="font-normal text-xs text-danger mt-1">
        {errors[name]}
      </p>
    ) : null;
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[22px] text-brand">Promotions</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-brand-light rounded-md p-1">
            <button
              disabled
              title="All promotion validity periods are listed"
              className="font-normal text-xs text-ink px-3 py-1 rounded button button-secondary"
            >
              Day
            </button>
            <button
              disabled
              title="All promotion validity periods are listed"
              className="font-medium text-xs text-ink px-3 py-1 rounded bg-surface shadow-sm button button-secondary"
            >
              Week
            </button>
            <button
              disabled
              title="All promotion validity periods are listed"
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

      {error && (
        <p role="alert" className="font-normal text-[13px] text-danger mb-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="font-normal text-[13px] text-ink mb-3">
          {notice}
        </p>
      )}
      <button
        type="button"
        disabled={busy || loading}
        onClick={reload}
        className="font-normal text-xs text-ink underline button button-ghost"
      >
        Refresh promotions
      </button>
      {conflict && (
        <button
          type="button"
          disabled={busy}
          onClick={recover}
          className="font-normal text-xs text-ink underline button button-ghost"
        >
          Reload latest version (keep entered values)
        </button>
      )}
      {/* Create promotion form */}
      <section className="mb-8">
        <h2 className="underline mb-3 font-medium text-base text-ink">Promotion management</h2>
        <form
          noValidate
          onSubmit={event => {
            event.preventDefault();
            save('ACTIVE');
          }}
          className="border border-border rounded-lg p-5"
        >
          <h3 className="font-medium text-[13px] text-ink mb-4">
            {editing ? 'Edit promotion' : 'Create new promotion'}
          </h3>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="code" className="font-normal text-xs text-muted block mb-1">
                Promo code
              </label>
              <input
                id="code"
                name="code"
                aria-invalid={!!errors.code}
                aria-describedby={errors.code ? 'code-error' : undefined}
                disabled={busy}
                type="text"
                className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                value={form.code}
                onChange={e => field('code', e.target.value)}
              />
              {fieldError('code')}
            </div>
            <div>
              <label htmlFor="discountType" className="font-normal text-xs text-muted block mb-1">
                Discount type
              </label>
              <select
                id="discountType"
                name="discountType"
                aria-invalid={!!errors.discountType}
                aria-describedby={errors.discountType ? 'discountType-error' : undefined}
                disabled={busy}
                className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                value={form.discountType}
                onChange={e => field('discountType', e.target.value as PromotionForm['discountType'])}
              >
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FIXED_AMOUNT">Fixed amount (LKR cents)</option>
              </select>
              {fieldError('discountType')}
            </div>
            <div>
              <label htmlFor="discountValue" className="font-normal text-xs text-muted block mb-1">
                Discount value
              </label>
              <input
                id="discountValue"
                name="discountValue"
                aria-invalid={!!errors.discountValue}
                aria-describedby={errors.discountValue ? 'discountValue-error' : undefined}
                disabled={busy}
                type="number"
                min="1"
                step="1"
                className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                value={form.discountValue}
                onChange={e => field('discountValue', e.target.value)}
              />
              {fieldError('discountValue')}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="validFrom" className="font-normal text-xs text-muted block mb-1">
                Valid from
              </label>
              <input
                id="validFrom"
                name="validFrom"
                aria-invalid={!!errors.validFrom}
                aria-describedby={errors.validFrom ? 'validFrom-error' : undefined}
                disabled={busy}
                type="datetime-local"
                step="0.001"
                className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                value={form.validFrom}
                onChange={e => field('validFrom', e.target.value)}
              />
              {fieldError('validFrom')}
            </div>
            <div>
              <label htmlFor="validUntil" className="font-normal text-xs text-muted block mb-1">
                Valid until
              </label>
              <input
                id="validUntil"
                name="validUntil"
                aria-invalid={!!errors.validUntil}
                aria-describedby={errors.validUntil ? 'validUntil-error' : undefined}
                disabled={busy}
                type="datetime-local"
                step="0.001"
                className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                value={form.validUntil}
                onChange={e => field('validUntil', e.target.value)}
              />
              {fieldError('validUntil')}
            </div>
            <div>
              <label htmlFor="maxRedemptions" className="font-normal text-xs text-muted block mb-1">
                Max redemptions
              </label>
              <input
                id="maxRedemptions"
                name="maxRedemptions"
                aria-invalid={!!errors.maxRedemptions}
                aria-describedby={errors.maxRedemptions ? 'maxRedemptions-error' : undefined}
                disabled={busy}
                type="number"
                min="1"
                step="1"
                className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                value={form.maxRedemptions}
                onChange={e => field('maxRedemptions', e.target.value)}
              />
              {fieldError('maxRedemptions')}
            </div>
          </div>

          <div className="mb-5">
            <label htmlFor="roomTypeIds" className="font-normal text-xs text-muted block mb-1">
              Applicable room types
            </label>
            <select
              multiple
              id="roomTypeIds"
              name="roomTypeIds"
              aria-invalid={!!errors.roomTypeIds}
              aria-describedby={errors.roomTypeIds ? 'roomTypeIds-error' : undefined}
              disabled={busy}
              className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
              value={form.roomTypeIds}
              onChange={e =>
                field(
                  'roomTypeIds',
                  Array.from(e.target.selectedOptions, o => o.value)
                )
              }
            >
              {rooms.map(room => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
            {fieldError('roomTypeIds')}
          </div>

          <p className="font-normal text-xs text-muted mb-3">
            Times use Asia/Colombo (+05:30), start inclusive and end exclusive. Fixed discounts use integer LKR cents
            (100 cents = LKR 1). Select one or more room types.
          </p>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy || !roomsReady || conflict}
              className="font-normal text-[13px] text-ink bg-brand-light rounded-md px-4 py-2 button button-accent"
            >
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Save & activate'}
            </button>
            <button
              type="button"
              disabled={busy || (!editing && (!roomsReady || conflict))}
              onClick={() => {
                if (editing) {
                  setEditing(undefined);
                  setForm({ ...emptyForm });
                  setErrors({});
                  setConflict(false);
                } else save('INACTIVE');
              }}
              className="font-normal text-[13px] text-ink border border-border rounded-md px-4 py-2 button button-primary"
            >
              {editing ? 'Cancel edit' : 'Save as draft'}
            </button>
          </div>
        </form>
      </section>

      {/* Promotions table */}
      <section className="mb-10">
        <h2 className="mb-3 font-medium text-base text-ink">Promotions</h2>
        <div
          className="border border-border rounded-lg overflow-x-auto bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Promotion register data"
        >
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">Promotions matching current filters</caption>
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                {['Code', 'Discount', 'Valid until', 'Used / Max', 'Rooms', 'Status', 'Actions'].map(h => (
                  <th key={h} className="font-medium text-xs text-ink px-3 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} role="status" className="text-xs text-ink px-3 py-3">
                    Loading promotions...
                  </td>
                </tr>
              )}
              {!loading && !promos.length && !error && (
                <tr>
                  <td colSpan={7} className="text-xs text-ink px-3 py-3">
                    No promotions yet.
                  </td>
                </tr>
              )}
              {!loading &&
                promos.map((p, i, arr) => (
                  <tr key={p.code} className={i < arr.length - 1 ? 'border-b border-border' : ''}>
                    <td className="text-xs text-ink px-3 py-3">{p.code}</td>
                    <td className="text-xs text-ink px-3 py-3">
                      {p.discountType === 'PERCENTAGE'
                        ? `${p.discountValue}%`
                        : `LKR ${(p.discountValue / 100).toFixed(2)}`}
                    </td>
                    <td className="text-xs text-ink px-3 py-3">
                      {new Date(p.validUntil).toLocaleString('en-GB', {
                        timeZone: 'Asia/Colombo'
                      })}
                    </td>
                    <td className="text-xs text-ink px-3 py-3">
                      {p.currentRedemptions} / {p.maxRedemptions}
                    </td>
                    <td className="text-xs text-ink px-3 py-3">
                      {p.roomTypeIds.map(id => rooms.find(r => r.id === id)?.name ?? id).join(', ')}
                    </td>
                    <td className="px-3 py-3">
                      <span className={'status-badge ' + statusColor(p.lifecycleState)}>{p.lifecycleState}</span>
                      <p className="font-normal text-xs text-muted mt-1">{publicationLabel(p.publicationStatus)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        disabled={busy || conflict}
                        onClick={() => edit(p)}
                        className="font-normal text-xs text-ink underline button button-ghost"
                      >
                        Edit
                      </button>
                      {' / '}
                      <button
                        disabled={
                          busy ||
                          conflict ||
                          (p.status === 'INACTIVE' &&
                            (Date.parse(p.validUntil) <= Date.now() || p.currentRedemptions >= p.maxRedemptions))
                        }
                        onClick={() => action(p, p.status === 'ACTIVE' ? 'deactivate' : 'activate')}
                        className={'button ' + (p.status === 'ACTIVE' ? 'button-danger' : 'button-success')}
                      >
                        {p.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </button>
                      {' / '}
                      <button
                        disabled={busy || conflict}
                        onClick={() => action(p, 'delete')}
                        className="font-normal text-xs text-ink underline button button-danger"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3 mt-3">
          <button
            disabled={busy || loading || page === 1}
            onClick={() => {
              setLoading(true);
              setPage(page - 1);
            }}
            className="font-normal text-xs text-ink underline button button-ghost"
          >
            Previous page
          </button>
          <span className="text-xs text-ink">
            Page {page} / {Math.max(1, Math.ceil(total / 20))}
          </span>
          <button
            disabled={busy || loading || page * 20 >= total}
            onClick={() => {
              setLoading(true);
              setPage(page + 1);
            }}
            className="font-normal text-xs text-ink underline button button-ghost"
          >
            Next page
          </button>
        </div>
      </section>
    </main>
  );
}
