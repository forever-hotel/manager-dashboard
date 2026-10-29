'use client';
import Pagination from './Pagination';
import { useEffect, useState } from 'react';
import { kitchenSnapshotSchema, kitchenLabels, type KitchenSnapshot, type KitchenStatus } from '@/lib/kitchen';
import { useOperationsSnapshot } from './useOperationsSnapshot';
export default function KitchenQueue({ onSnapshot }: { onSnapshot?: (snapshot: KitchenSnapshot | null) => void } = {}) {
  const [page, setPage] = useState(1);
  const { snapshot, message, retry } = useOperationsSnapshot(
    '/api/kitchen/orders?activeOnly=true&page=' + page + '&pageSize=100',
    kitchenSnapshotSchema,
    'transport.status',
    'kitchen.order.changed'
  );
  useEffect(() => {
    onSnapshot?.(snapshot);
  }, [snapshot, onSnapshot]);
  const group = (status: Exclude<KitchenStatus, 'DELIVERED'>) => (
    <div aria-label={kitchenLabels[status]}>
      <div className="kitchen-column-heading">
        <span>{{ PLACED: 'New', IN_PREPARATION: 'Preparing', READY: 'Ready' }[status]}</span>
        <span
          className={
            'status-badge ' +
            (status === 'PLACED'
              ? 'bg-brand-light text-brand'
              : status === 'IN_PREPARATION'
                ? 'bg-warning-light text-warning'
                : 'bg-success-light text-success')
          }
        >
          {snapshot ? snapshot.counts[status] : '\u2014'}
        </span>
      </div>
      {snapshot?.orders
        .filter(order => order.status === status)
        .map(order => (
          <div key={order.id} className="kitchen-order">
            <div>Room {order.roomNumber}</div>
            <small>
              {order.mealPeriod} &middot; {order.itemCount} items &middot;{' '}
              {new Date(order.placedAt).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Colombo'
              })}
            </small>
          </div>
        ))}
      {snapshot && !snapshot.orders.some(order => order.status === status) && <p className="page-note">No orders.</p>}
    </div>
  );
  return (
    <section className="data-panel">
      <div className="panel-heading">
        <h2>Kitchen queue (live)</h2>
      </div>
      {message && (
        <p className="page-note px-5" role="status">
          {message}
          {message !== 'Loading...' && (
            <button type="button" className="button button-ghost" onClick={retry}>
              Retry
            </button>
          )}
        </p>
      )}
      <div className="kitchen-columns">
        <div className="kitchen-column">{group('PLACED')}</div>
        <div className="kitchen-column">{group('IN_PREPARATION')}</div>
        <div className="kitchen-column kitchen-ready">{group('READY')}</div>
      </div>
      {snapshot && (page > 1 || snapshot.total > 100) && (
        <Pagination page={page} pageSize={100} total={snapshot.total} noun="orders" onChange={setPage} />
      )}
    </section>
  );
}
