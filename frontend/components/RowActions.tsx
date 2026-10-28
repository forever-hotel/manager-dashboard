'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function RowActions({
  label,
  triggerId,
  disabled,
  children
}: {
  label: string;
  triggerId?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  useEffect(() => {
    if (!position) return;
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = () => setPosition(undefined);
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) dismiss();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
        trigger.current?.focus();
      }
      if (event.key === 'Tab') dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className="button button-ghost promotion-kebab"
        disabled={disabled}
        aria-label={label}
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        onClick={() => {
          if (position) {
            setPosition(undefined);
            return;
          }
          const rect = trigger.current!.getBoundingClientRect();
          setPosition({
            top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 180)),
            left: Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216))
          });
        }}
      >
        <span aria-hidden="true">&#8942;</span>
      </button>
      {position &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="group"
            aria-label={label}
            className="row-actions-popup"
            style={position}
            onClickCapture={event => {
              if ((event.target as HTMLElement).closest('button')) trigger.current?.focus();
            }}
            onClick={event => {
              if ((event.target as HTMLElement).closest('button')) setPosition(undefined);
            }}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
