'use client';

import Pagination from './Pagination';
import RowActions from '@/components/RowActions';
import RoomTypeSelect from './RoomTypeSelect';
import HeaderNotifications from '@/components/HeaderNotifications';
import SuccessDialog from '@/components/SuccessDialog';
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
  const [view, setView] = useState<'active' | 'inactive' | 'scheduled'>('active');
  const [selected, setSelected] = useState<Promotion>();
  const [confirmAction, setConfirmAction] = useState<'activate' | 'deactivate' | 'delete'>();
  const actionPanel = useRef<HTMLDialogElement>(null);
  const formPanel = useRef<HTMLFormElement>(null);
  const roomCache = useRef<RoomType[] | undefined>(undefined);

  useEffect(() => {
    if (!selected || !confirmAction) return;
    const dialog = actionPanel.current;
    const previous = document.activeElement;

    dialog?.showModal();
    dialog?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [selected, confirmAction]);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [form, setForm] = useState<PromotionForm>(() => ({
    ...emptyForm,
    ...promotionDates(initialDate)
  }));
  const [editing, setEditing] = useState<Promotion>();

  useEffect(() => {
    if (editing) {
      formPanel.current?.focus({ preventScroll: true });
      formPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [editing]);
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
            `?page=${page}&pageSize=20&view=${view}`,
            pageSchema(promotionSchema),
            'GET',
            undefined,
            controller.signal
          ),
          (async () => {
            if (roomCache.current) return roomCache.current;
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
              if (values.length >= part.total) {
                roomCache.current = values;
                return values;
              }
              if (!part.items.length) throw new Error('Incomplete room types');
              current++;
            }
          })()
        ]);

        if (active) {
          setError('');
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
  }, [page, refresh, view]);
  useEffect(() => {
    const timer = setInterval(() => setRefresh(value => value + 1), 30000);

    return () => clearInterval(timer);
  }, []);
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
      setSelected(undefined);
      setConfirmAction(undefined);
      setForm(formFrom(latest));
      setErrors({});
      setConflict(false);
    });
  }
  function recover() {
    if (!editing) {
      if (selected)
        void work(async () => {
          const latest = await promotionRequest('/' + selected.id, promotionSchema);

          setSelected(latest);
          setConfirmAction(undefined);
          setConflict(false);
          reload();
        });
      else {
        setConflict(false);
        reload();
      }
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
    void work(async () => {
      const saved = await promotionRequest(
        '/' + p.id + (action === 'delete' ? '' : '/' + action),
        promotionSchema,
        action === 'delete' ? 'DELETE' : 'POST',
        { version: p.version }
      );

      setSelected(undefined);
      setConfirmAction(undefined);
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
    <main className="dashboard-page">
      {/* Top bar */}
      <div className="page-topbar">
        <h1 className="font-medium text-[22px] text-brand">Promotions</h1>
        <div className="flex items-center gap-4">
          <HeaderNotifications />
        </div>
      </div>

      {error && !confirmAction && (
        <p role="alert" className="font-normal text-[13px] text-danger mb-3">
          {error}{' '}
          <button type="button" className="button button-ghost" disabled={busy} onClick={reload}>
            Retry promotions
          </button>
        </p>
      )}
      <SuccessDialog message={notice} onClose={() => setNotice('')} />

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
        <h2 className="section-eyebrow">Promotion management</h2>
        <form
          ref={formPanel}
          tabIndex={-1}
          noValidate
          onSubmit={event => {
            event.preventDefault();
            save('ACTIVE');
          }}
          className="promotion-create-form border border-border rounded-lg p-5 bg-surface"
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
                type="date"
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
                type="date"
                className="w-full border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink"
                value={form.validUntil}
                onChange={e => field('validUntil', e.target.value)}
              />
              {fieldError('validUntil')}
              <p className="text-xs text-muted mt-1">Includes this entire date (Sri Lanka time).</p>
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
            <RoomTypeSelect
              rooms={rooms}
              value={form.roomTypeIds}
              onChange={ids => field('roomTypeIds', ids)}
              disabled={busy || !roomsReady}
              invalid={!!errors.roomTypeIds}
              describedBy={errors.roomTypeIds ? 'roomTypeIds-error' : undefined}
            />
            {fieldError('roomTypeIds')}
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy || !roomsReady || conflict}
              className="font-normal text-[13px] text-ink bg-brand-light rounded-md px-4 py-2 button button-primary"
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
              className="font-normal text-[13px] text-ink border border-border rounded-md px-4 py-2 button button-secondary"
            >
              {editing ? 'Cancel edit' : 'Save as draft'}
            </button>
          </div>
        </form>
      </section>

      {/* Promotions table */}
      <section className="register-section mb-10">
        <div className="panel-heading">
          <h2>
            {view === 'active'
              ? 'Active promotions'
              : view === 'inactive'
                ? 'Inactive promotions'
                : 'Scheduled promotions'}
          </h2>
          <label className="promotion-view-filter text-xs text-muted">
            <span>Show promotions</span>
            <select
              aria-label="Show promotions"
              className="button button-secondary"
              value={view}
              disabled={busy}
              onChange={event => {
                setView(event.target.value as typeof view);
                setPage(1);
                setSelected(undefined);
                setConfirmAction(undefined);
                setConflict(false);
                setLoading(true);
                setError('');
              }}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="scheduled">Scheduled</option>
            </select>
          </label>
        </div>
        <div
          className="border border-border rounded-lg overflow-x-auto bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Promotion register data"
        >
          <table className="w-full text-left border-collapse dashboard-table">
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
                    No unexpired promotions in this view.
                  </td>
                </tr>
              )}
              {!loading &&
                promos
                  .filter(p => !p.deletedAt && Date.parse(p.validUntil) > Date.now())
                  .map((p, i, arr) => (
                    <tr key={p.code} className={i < arr.length - 1 ? 'border-b border-border' : ''}>
                      <td className="text-xs text-ink px-3 py-3">{p.code}</td>
                      <td className="text-xs text-ink px-3 py-3">
                        {p.discountType === 'PERCENTAGE'
                          ? `${p.discountValue}%`
                          : `LKR ${(p.discountValue / 100).toFixed(2)}`}
                      </td>
                      <td className="text-xs text-ink px-3 py-3">
                        {new Date(Date.parse(p.validUntil) - 1).toLocaleDateString('en-GB', {
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
                        <RowActions label={'Actions for ' + p.code} disabled={busy || conflict}>
                          <button type="button" onClick={() => edit(p)}>
                            Edit promotion
                          </button>
                          <button
                            type="button"
                            disabled={p.status === 'INACTIVE' && p.currentRedemptions >= p.maxRedemptions}
                            onClick={() => {
                              setSelected(p);
                              setConfirmAction(p.status === 'ACTIVE' ? 'deactivate' : 'activate');
                            }}
                          >
                            {p.status === 'ACTIVE' ? 'Deactivate promotion' : 'Activate promotion'}
                          </button>
                          <button
                            type="button"
                            className="text-danger"
                            onClick={() => {
                              setSelected(p);
                              setConfirmAction('delete');
                            }}
                          >
                            Delete promotion
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
          noun="promotions"
          disabled={busy || loading}
          onChange={value => {
            setLoading(true);
            setPage(value);
          }}
        />
      </section>
      {selected && confirmAction && (
        <dialog
          role="alertdialog"
          onCancel={event => {
            if (busy) event.preventDefault();
            else {
              setSelected(undefined);
              setConfirmAction(undefined);
            }
          }}
          id="promotion-action-panel"
          ref={actionPanel}
          tabIndex={-1}
          className="success-dialog"
          aria-labelledby="promotion-action-heading"
        >
          <div className="panel-heading">
            <h2 id="promotion-action-heading">Actions for {selected.code}</h2>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => {
                setSelected(undefined);
                setConfirmAction(undefined);
              }}
            >
              Close actions
            </button>
          </div>
          <div className="promotion-action-body">
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            {conflict && (
              <button type="button" disabled={busy} className="button button-secondary" onClick={recover}>
                Reload latest version
              </button>
            )}
            {Date.parse(selected.validUntil) <= Date.now() || selected.deletedAt ? (
              <p>This promotion has expired or been deleted. It cannot be activated.</p>
            ) : confirmAction ? (
              <>
                <h3>
                  {confirmAction === 'delete'
                    ? 'Delete promotion?'
                    : confirmAction === 'deactivate'
                      ? 'Deactivate promotion?'
                      : 'Activate promotion?'}
                </h3>
                <p>
                  {confirmAction === 'delete'
                    ? 'This permanently removes the promotion from use. Existing booking history is retained and the code cannot be reused.'
                    : confirmAction === 'deactivate'
                      ? 'This promotion will stop being available after the website receives the update. You can activate it again before it expires.'
                      : 'This promotion will become available during its validity period after the website receives the update.'}
                </p>
                <div className="flex flex-wrap gap-3 mt-4">
                  <button
                    type="button"
                    disabled={busy || conflict}
                    className={'button ' + (confirmAction === 'delete' ? 'button-danger' : 'button-primary')}
                    onClick={() => action(selected, confirmAction)}
                  >
                    {busy
                      ? 'Saving...'
                      : confirmAction === 'delete'
                        ? 'Confirm delete'
                        : confirmAction === 'deactivate'
                          ? 'Confirm deactivate'
                          : 'Confirm activate'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="button button-secondary"
                    onClick={() => setConfirmAction(undefined)}
                  >
                    Cancel action
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </dialog>
      )}
    </main>
  );
}
