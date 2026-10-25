'use client';
import React from 'react';
import { useOperationsSnapshot } from '@/components/useOperationsSnapshot';
import { roomSnapshotSchema } from '@/lib/rooms';

const topBarSvg = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

function TopBar({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="font-medium text-[15px] text-black">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
          <button
            type="button"
            disabled
            title="Room status shows the current snapshot only"
            className="font-normal text-[10.5px] text-black px-3 py-1 rounded"
          >
            Day
          </button>
          <button
            type="button"
            disabled
            title="Room status shows the current snapshot only"
            className="font-medium text-[10.5px] text-black px-3 py-1 rounded bg-white shadow-sm"
          >
            Week
          </button>
          <button
            type="button"
            disabled
            title="Room status shows the current snapshot only"
            className="font-normal text-[10.5px] text-black px-3 py-1 rounded"
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
  OCCUPIED: { bg: '#e6f1fb', text: '#0c447c', label: 'Occ' },
  VACANT: { bg: '#eaf3de', text: '#27500a', label: 'Free' },
  REQUIRES_CLEANING: { bg: '#faeeda', text: '#633806', label: 'Clean' },
  UNDER_MAINTENANCE: { bg: '#fcebeb', text: '#791f1f', label: 'Maint' }
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
        <div role="status" className="font-normal text-[10px] text-black/60 mb-3">
          {message}{' '}
          <button type="button" className="underline" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      <p className="font-normal text-[10px] text-black/60 mb-3">Current snapshot ? Read only</p>

      {/* Summary cards */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">Real-time room status board</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Vacant</div>
            <div className="font-medium text-[22px]" style={{ color: '#27500a' }}>
              {count('VACANT')}
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Occupied</div>
            <div className="font-medium text-[22px]" style={{ color: '#0c447c' }}>
              {count('OCCUPIED')}
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Requires cleaning</div>
            <div className="font-medium text-[22px]" style={{ color: '#633806' }}>
              {count('REQUIRES_CLEANING')}
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Maintenance</div>
            <div className="font-medium text-[22px]" style={{ color: '#791f1f' }}>
              {count('UNDER_MAINTENANCE')}
            </div>
          </div>
        </div>
      </section>

      {/* Floor plan */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-[13px] text-black">Floor plan — all rooms</h2>
          <div className="flex items-center gap-4">
            {(['Vacant', 'Occupied', 'Cleaning', 'Maintenance'] as const).map((label, i) => {
              const colors = ['#eaf3de', '#e6f1fb', '#faeeda', '#fcebeb'];
              return (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[i] }} />
                  <span className="font-normal text-[9.5px] text-black">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg p-5 space-y-5">
          {snapshot?.rooms.length === 0 && <p className="font-normal text-[10px] text-black/60">No rooms available.</p>}
          {floors.map(floor => (
            <div key={floor}>
              <div className="font-normal text-[10.5px] text-black mb-2">Floor {floor}</div>
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
                        <span className="font-medium text-[9px] leading-tight" style={{ color: cfg.text }}>
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
