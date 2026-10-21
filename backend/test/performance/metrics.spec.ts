import { evaluateTimings, percentile, TimingEvidence } from './metrics';

describe('DDP-047 timing evidence', () => {
  const evidence = (): TimingEvidence => ({
    expectedClientIds: ['0', '1'],
    events: [
      {
        eventId: 'committed-1',
        committedAt: 10000,
        receipts: [
          { clientId: '0', receivedAt: 10500, visibleAt: 11000 },
          { clientId: '1', receivedAt: 11000, visibleAt: 11000 },
        ],
      },
    ],
  });

  it('uses nearest-rank percentiles including the exact 95% boundary', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([...Array<number>(19).fill(500), 900], 0.95)).toBe(500);
  });

  it('accepts complete correlated evidence at the inclusive one-second limits', () => {
    expect(evaluateTimings(evidence(), 1000)).toMatchObject({
      pass: true,
      samples: 2,
      propagationMaxMs: 1000,
      visibleMaxMs: 1000,
    });
  });

  it('never treats received timestamps as browser-render evidence', () => {
    const data = evidence();
    data.events[0].receipts[0].visibleAt = Number.NaN;
    expect(evaluateTimings(data, 1000).pass).toBe(false);
  });

  it.each(['missing', 'duplicate', 'negative', 'inverted', 'late'])(
    'fails %s observations',
    (variant) => {
      const data = evidence();
      const receipts = data.events[0].receipts;
      if (variant === 'missing') receipts.pop();
      if (variant === 'duplicate') receipts.push({ ...receipts[0] });
      if (variant === 'negative') receipts[0].receivedAt = 9999;
      if (variant === 'inverted') receipts[0].visibleAt = 10001;
      if (variant === 'late')
        receipts[0].receivedAt = receipts[0].visibleAt = 11001;
      expect(evaluateTimings(data, 1000).pass).toBe(false);
    },
  );

  it('applies the chosen UI budget separately from propagation', () => {
    const data = evidence();
    data.events[0].receipts[0].visibleAt = 11500;
    expect(evaluateTimings(data, 1000).pass).toBe(false);
    expect(evaluateTimings(data, 2000).pass).toBe(true);
  });

  it.each(['empty', 'clients', 'event', 'budget'])(
    'rejects invalid %s configuration',
    (variant) => {
      const data = evidence();
      if (variant === 'empty') data.events = [];
      if (variant === 'clients') data.expectedClientIds.push('0');
      if (variant === 'event') data.events.push(data.events[0]);
      expect(() =>
        evaluateTimings(data, variant === 'budget' ? 500 : 1000),
      ).toThrow();
    },
  );
});
