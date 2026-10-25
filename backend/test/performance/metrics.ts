export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export interface TimingEvidence {
  expectedClientIds: string[];
  events: {
    eventId: string;
    committedAt: number;
    receipts: { clientId: string; receivedAt: number; visibleAt: number }[];
  }[];
}

// Inputs use independently correlated source-commit/browser timestamps in epoch ms.
// Missing, duplicate, negative or non-finite timings fail closed.
export function evaluateTimings(evidence: TimingEvidence, uiBudgetMs: number) {
  if (
    ![1000, 2000].includes(uiBudgetMs) ||
    !evidence.expectedClientIds.length ||
    !evidence.expectedClientIds.every(id => typeof id === 'string' && id.length > 0) ||
    new Set(evidence.expectedClientIds).size !== evidence.expectedClientIds.length ||
    !evidence.events.length ||
    new Set(evidence.events.map(event => event.eventId)).size !== evidence.events.length
  )
    throw new Error('Invalid timing evidence');
  const propagation: number[] = [];
  const visible: number[] = [];
  let complete = true;
  for (const event of evidence.events) {
    const clients = new Set(event.receipts.map(receipt => receipt.clientId));
    complete &&=
      event.eventId.length > 0 &&
      Number.isFinite(event.committedAt) &&
      clients.size === evidence.expectedClientIds.length &&
      event.receipts.length === clients.size &&
      evidence.expectedClientIds.every(id => clients.has(id));
    for (const receipt of event.receipts) {
      const received = receipt.receivedAt - event.committedAt;
      const rendered = receipt.visibleAt - event.committedAt;
      complete &&=
        Number.isFinite(receipt.receivedAt) &&
        Number.isFinite(receipt.visibleAt) &&
        Number.isFinite(received) &&
        Number.isFinite(rendered) &&
        received >= 0 &&
        rendered >= received;
      propagation.push(received);
      visible.push(rendered);
    }
  }
  return {
    complete,
    samples: propagation.length,
    propagationP95Ms: percentile(propagation, 0.95),
    propagationMaxMs: propagation.length ? propagation.reduce((a, b) => Math.max(a, b), 0) : null,
    visibleP95Ms: percentile(visible, 0.95),
    visibleMaxMs: visible.length ? visible.reduce((a, b) => Math.max(a, b), 0) : null,
    pass:
      complete &&
      propagation.length > 0 &&
      propagation.every(ms => ms <= 1000) &&
      visible.every(ms => ms <= uiBudgetMs),
    uiBudgetMs
  };
}
