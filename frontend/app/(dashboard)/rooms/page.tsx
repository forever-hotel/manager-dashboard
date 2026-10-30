'use client';

import HeaderNotifications from '@/components/HeaderNotifications';
import { useOperationsSnapshot } from '@/components/useOperationsSnapshot';
import { roomSnapshotSchema } from '@/lib/rooms';

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
    snapshot ? snapshot.rooms.filter(r => r.status === status).length : '\u2014';

  return (
    <main className="dashboard-page">
      <div className="page-topbar">
        <h1>Room status</h1>
        <HeaderNotifications />
      </div>
      {message && (
        <div role="status" className="page-note mb-4">
          {message}
          {message !== 'Loading...' && (
            <button type="button" className="button button-ghost" onClick={retry}>
              Retry
            </button>
          )}
        </div>
      )}

      {/* Summary cards */}
      <section className="mb-6">
        <h2 className="section-eyebrow">Real-time room status board</h2>
        <div className="summary-grid">
          <div className="summary-card">
            <div className="font-normal text-xs text-muted mb-2">Vacant</div>
            <div className="font-medium text-[30px]" style={{ color: 'var(--color-success)' }}>
              {count('VACANT')}
            </div>
          </div>
          <div className="summary-card">
            <div className="font-normal text-xs text-muted mb-2">Occupied</div>
            <div className="font-medium text-[30px]" style={{ color: 'var(--color-brand)' }}>
              {count('OCCUPIED')}
            </div>
          </div>
          <div className="summary-card">
            <div className="font-normal text-xs text-muted mb-2">Requires cleaning</div>
            <div className="font-medium text-[30px]" style={{ color: 'var(--color-warning)' }}>
              {count('REQUIRES_CLEANING')}
            </div>
          </div>
          <div className="summary-card">
            <div className="font-normal text-xs text-muted mb-2">Maintenance</div>
            <div className="font-medium text-[30px]" style={{ color: 'var(--color-danger)' }}>
              {count('UNDER_MAINTENANCE')}
            </div>
          </div>
        </div>
      </section>

      {/* Floor plan */}
      <section className="room-panel">
        <div className="room-panel-title">
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
        <div className="space-y-4">
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
                        className="room-cell h-10 rounded flex items-center justify-center text-center"
                        style={{ backgroundColor: cfg.bg, color: cfg.text }}
                      >
                        <span className="font-medium text-xs leading-tight" style={{ color: cfg.text }}>
                          {room.number}
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
