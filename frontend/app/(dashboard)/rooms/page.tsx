'use client';
import React from 'react';
import { useOperationsSnapshot } from '@/components/useOperationsSnapshot';
import { roomSnapshotSchema } from '@/lib/rooms';

const topBarSvg = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

function TopBar({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="font-medium text-[22px] text-brand">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 bg-brand-light rounded-md p-1">
          <button
            type="button"
            disabled
            title="Room status shows the current snapshot only"
            className="font-normal text-xs text-ink px-3 py-1 rounded button button-secondary"
          >
            Day
          </button>
          <button
            type="button"
            disabled
            title="Room status shows the current snapshot only"
            className="font-medium text-xs text-ink px-3 py-1 rounded bg-surface shadow-sm button button-secondary"
          >
            Week
          </button>
          <button
            type="button"
            disabled
            title="Room status shows the current snapshot only"
            className="font-normal text-xs text-ink px-3 py-1 rounded button button-secondary"
          >
            Month
          </button>
        </div>
        {topBarSvg}
      </div>
    </div>
  );
}

const statusConfig = {
  OCCUPIED: { bg: 'var(--color-brand-light)', text: 'var(--color-brand)', label: 'Occ' },
  VACANT: { bg: 'var(--color-success-light)', text: 'var(--color-success)', label: 'Free' },
  REQUIRES_CLEANING: { bg: 'var(--color-warning-light)', text: 'var(--color-warning)', label: 'Clean' },
  UNDER_MAINTENANCE: { bg: 'var(--color-danger-light)', text: 'var(--color-danger)', label: 'Maint' }
};

export default function RoomsPage() {
  const { snapshot, message, retry } = useOperationsSnapshot(
    '/api/rooms/status',
    roomSnapshotSchema,
    'rooms.transport.status',
    'room.status.changed'
  );
  const floors = [...new Set(snapshot?.rooms.map(r => r.floor) ?? [])].sort((a, b) => a - b);
  const count = (status: keyof typeof statusConfig) =>
    snapshot ? snapshot.rooms.filter(r => r.status === status).length : '?';
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      <TopBar title="Room status" />
      {message && (
        <div role="status" className="font-normal text-xs text-muted mb-3">
          {message}{' '}
          <button type="button" className="underline button button-ghost" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      <p className="font-normal text-xs text-muted mb-3">Current snapshot ? Read only</p>

      {/* Summary cards */}
      <section className="mb-6">
        <h2 className="underline mb-3 font-medium text-base text-ink">Real-time room status board</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-border rounded-lg p-4 bg-surface">
            <div className="font-normal text-xs text-muted mb-2">Vacant</div>
            <div className="font-medium text-[24px]" style={{ color: 'var(--color-success)' }}>
              {count('VACANT')}
            </div>
          </div>
          <div className="border border-border rounded-lg p-4 bg-surface">
            <div className="font-normal text-xs text-muted mb-2">Occupied</div>
            <div className="font-medium text-[24px]" style={{ color: 'var(--color-brand)' }}>
              {count('OCCUPIED')}
            </div>
          </div>
          <div className="border border-border rounded-lg p-4 bg-surface">
            <div className="font-normal text-xs text-muted mb-2">Requires cleaning</div>
            <div className="font-medium text-[24px]" style={{ color: 'var(--color-warning)' }}>
              {count('REQUIRES_CLEANING')}
            </div>
          </div>
          <div className="border border-border rounded-lg p-4 bg-surface">
            <div className="font-normal text-xs text-muted mb-2">Maintenance</div>
            <div className="font-medium text-[24px]" style={{ color: 'var(--color-danger)' }}>
              {count('UNDER_MAINTENANCE')}
            </div>
          </div>
        </div>
      </section>

      {/* Floor plan */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-base text-ink">Floor plan — all rooms</h2>
          <div className="flex items-center gap-4">
            {(['Vacant', 'Occupied', 'Cleaning', 'Maintenance'] as const).map((label, i) => {
              const colors = [
                'var(--color-success-light)',
                'var(--color-brand-light)',
                'var(--color-warning-light)',
                'var(--color-danger-light)'
              ];
              return (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[i] }} />
                  <span className="font-normal text-xs text-ink">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="border border-border rounded-lg p-5 space-y-5 bg-surface">
          {snapshot?.rooms.length === 0 && <p className="font-normal text-xs text-muted">No rooms available.</p>}
          {floors.map(floor => (
            <div key={floor}>
              <div className="font-normal text-xs text-ink mb-2">Floor {floor}</div>
              <div className="grid grid-cols-8 gap-3">
                {snapshot?.rooms
                  .filter(r => r.floor === floor)
                  .map(room => {
                    const cfg = statusConfig[room.status];
                    return (
                      <div
                        key={room.id}
                        aria-label={`Room ${room.number}, ${room.label}, ${room.type}`}
                        className="h-10 rounded flex items-center justify-center text-center"
                        style={{ backgroundColor: cfg.bg }}
                      >
                        <span className="font-medium text-xs leading-tight" style={{ color: cfg.text }}>
                          {room.id}
                          <br />
                          {cfg.label}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
