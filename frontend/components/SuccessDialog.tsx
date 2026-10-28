'use client';

import { useEffect, useRef } from 'react';

export default function SuccessDialog({ message, onClose }: { message: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !message) return;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [message]);

  return (
    <dialog ref={dialog} className="success-dialog" aria-label="Operation completed" onCancel={onClose}>
      <h2>Success</h2>
      <p role="status">{message}</p>
      <button type="button" className="button button-primary" autoFocus onClick={onClose}>
        OK
      </button>
    </dialog>
  );
}
