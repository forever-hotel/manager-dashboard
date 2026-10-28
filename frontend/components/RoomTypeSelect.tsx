'use client';
import { useEffect, useRef, useState } from 'react';
import type { RoomType } from '@/lib/promotions';
export default function RoomTypeSelect({
  rooms,
  value,
  onChange,
  disabled,
  invalid,
  describedBy
}: {
  rooms: RoomType[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const matching = rooms.filter(room => room.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div ref={root} className="room-type-select">
      <button
        id="roomTypeIds"
        ref={trigger}
        type="button"
        disabled={disabled}
        data-invalid={invalid}
        aria-describedby={describedBy}
        aria-expanded={open && !disabled}
        aria-controls="room-type-options"
        onClick={() => setOpen(old => !old)}
        className="room-type-trigger"
      >
        <span>
          {value.length
            ? value.map(id => rooms.find(room => room.id === id)?.name ?? id).join(', ')
            : 'Choose room types'}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && !disabled && (
        <div id="room-type-options" className="room-type-options">
          <input
            ref={input}
            type="search"
            aria-label="Search room types"
            placeholder="Search room types…"
            onKeyDown={event => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          <div className="flex gap-3 py-2">
            <button
              type="button"
              className="button button-ghost"
              disabled={rooms.length > 100}
              onClick={() => onChange(rooms.map(room => room.id))}
            >
              Select all
            </button>
            <button type="button" className="button button-ghost" onClick={() => onChange([])}>
              Clear selection
            </button>
          </div>
          <div className="room-type-options-list">
            {matching.map(room => (
              <label key={room.id}>
                <input
                  type="checkbox"
                  checked={value.includes(room.id)}
                  disabled={!value.includes(room.id) && value.length >= 100}
                  onChange={event =>
                    onChange(event.target.checked ? [...value, room.id] : value.filter(id => id !== room.id))
                  }
                />
                <span>
                  {room.name}
                  <small>Up to {room.maxGuests} guests</small>
                </span>
              </label>
            ))}
          </div>
          {!matching.length && <p className="page-note">No matching room types.</p>}
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
