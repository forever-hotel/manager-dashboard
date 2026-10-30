'use client';

import { io, type Socket } from 'socket.io-client';

type Listener = (name: string, data?: unknown) => void;
const listeners = new Set<Listener>();
const status = new Map<string, unknown>();
const events = [
  'transport.status',
  'rooms.transport.status',
  'tasks.transport.status',
  'stock.transport.status',
  'notifications.transport.status',
  'analytics.transport.status',
  'kitchen.order.changed',
  'room.status.changed',
  'task.changed',
  'stock.alert.changed',
  'notifications.changed',
  'analytics.changed',
  'food.analytics.changed'
];
let socket: Socket | undefined;
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let attempts = 0;
let generation = 0;
const emit = (name: string, data?: unknown) => {
  for (const listener of [...listeners]) listener(name, data);
};

function schedule() {
  if (timer || !listeners.size) return;
  emit('live.offline');
  if (attempts >= 5) {
    emit('live.exhausted');
    return;
  }
  timer = setTimeout(
    () => {
      timer = undefined;
      void connect();
    },
    Math.min(1000 * 2 ** attempts++, 16000)
  );
}

async function connect() {
  const id = ++generation;

  controller?.abort();
  controller = new AbortController();
  socket?.removeAllListeners();
  socket?.disconnect();
  try {
    const response = await fetch('/api/realtime/ticket', {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal
    });

    if (id !== generation || !listeners.size) return;
    if ([401, 403].includes(response.status)) {
      emit('live.denied', response.status);
      return;
    }
    if (!response.ok) throw new Error();
    const data = (await response.json()) as { ticket: string; socketUrl: string };

    if (id !== generation || !listeners.size) return;
    socket = io(data.socketUrl, {
      path: '/realtime/socket.io',
      transports: ['websocket'],
      auth: { ticket: data.ticket },
      reconnection: false,
      timeout: 7000
    });
    socket.on('connect', () => {
      attempts = 0;
      emit('live.connected');
    });
    for (const name of events)
      socket.on(name, (payload: unknown) => {
        if (name.endsWith('transport.status')) status.set(name, payload);
        emit(name, payload);
      });
    socket.on('disconnect', schedule);
    socket.on('connect_error', schedule);
  } catch {
    if (id === generation) schedule();
  }
}

export function subscribeRealtime(listener: Listener) {
  listeners.add(listener);
  for (const [name, data] of status) listener(name, data);
  if (listeners.size === 1) void connect();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      generation++;
      controller?.abort();
      clearTimeout(timer);
      timer = undefined;
      attempts = 0;
      socket?.removeAllListeners();
      socket?.disconnect();
      socket = undefined;
      status.clear();
    }
  };
}

export function retryRealtime() {
  clearTimeout(timer);
  timer = undefined;
  attempts = 0;
  status.clear();
  // Allow React's subscription cleanup/remount to finish before reconnecting.
  // A sole subscriber remount starts its own connection and cancels this timer.
  timer = setTimeout(() => {
    timer = undefined;
    if (listeners.size) void connect();
  }, 0);
}
