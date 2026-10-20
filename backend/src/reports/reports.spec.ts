import {
  csvCell,
  flattenReport,
  renderCsv,
  renderPdf,
  MAX_REPORT_ROWS,
} from './report-renderer';
import { parseReportQuery, REPORT_TYPES } from './report-query';
import { ReportsService } from './reports.service';
import { BookingAnalyticsService } from '../analytics/booking-analytics.service';
import { RevenueAnalyticsService } from '../analytics/revenue-analytics.service';
import { WorkerPerformanceService } from '../analytics/worker-performance.service';
import { FoodAnalyticsService } from '../analytics/food-analytics.service';
import { ServiceRequestAnalyticsService } from '../analytics/service-request-analytics.service';
import { OccupancyAnalyticsService } from '../analytics/occupancy-analytics.service';
import { LowBookingAlertsService } from '../analytics/low-booking-alerts.service';
describe('DDP-030 report validation and encoding', () => {
  it('accepts only per-report filters and bounded periods', () => {
    for (const type of REPORT_TYPES)
      expect(
        parseReportQuery(type, {
          format: 'csv',
          ...(type === 'occupancy'
            ? { from: '2026-10-01', to: '2026-10-20' }
            : {}),
        }).format,
      ).toBe('csv');
    for (const [type, query] of [
      ['bad', { format: 'csv' }],
      ['bookings', {}],
      ['bookings', { format: 'xlsx' }],
      ['bookings', { format: 'pdf', period: 'year' }],
      ['bookings', { format: 'csv', workerId: 'x' }],
      ['staff', { format: 'csv', workerId: 'x' }],
      ['staff', { format: ['csv', 'pdf'] }],
      ['occupancy', { format: 'csv', from: '2026-02-30', to: '2026-03-01' }],
      ['occupancy', { format: 'csv', from: '2026-10-20', to: '2026-10-19' }],
      ['occupancy', { format: 'csv', from: '2025-01-01', to: '2026-10-20' }],
    ] as const)
      expect(() => parseReportQuery(type, query)).toThrow();
  });
  it('quotes commas/quotes/newlines and neutralizes formula prefixes after whitespace', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    for (const value of [
      '=SUM(A1)',
      '+1',
      '-1',
      '@test',
      ' \t=cmd',
      '\r=cmd',
      '\ntext',
    ])
      expect(csvCell(value)).toBe('"\'' + value + '"');
    expect(renderCsv([]).toString()).toBe('\ufeff"Field","Value","Unit"\r\n');
  });
  it('preserves zero/null/empty arrays, units and exact snapshot field paths', () => {
    const rows = flattenReport({
      currentMinor: 25000,
      percentageChange: null,
      rate: 0,
      averageMinutes: 2,
      trend: [{ count: 0 }],
      workers: [],
    });
    expect(rows).toContainEqual(['currentMinor', '25000', 'LKR cents']);
    expect(rows).toContainEqual(['percentageChange', 'null', 'unavailable']);
    expect(rows).toContainEqual(['trend[0].count', '0', 'count']);
    expect(rows).toContainEqual(['workers', '[]', 'empty']);
    expect(() => flattenReport({ value: 'x'.repeat(2049) })).toThrow();
    expect(() =>
      flattenReport({ rows: Array(MAX_REPORT_ROWS + 1).fill(0) }),
    ).toThrow();
  });

  it('bounds depth, paths and byte size and preserves remaining scalar units', () => {
    expect(
      flattenReport({
        percentageChange: 12,
        threshold: 0.2,
        averageMinutes: 3,
        active: true,
        empty: {},
        hour: 4,
      }),
    ).toEqual([
      ['percentageChange', '12', 'percent'],
      ['threshold', '0.2', 'ratio (0-1)'],
      ['averageMinutes', '3', 'minutes'],
      ['active', 'true', ''],
      ['empty', '{}', 'empty'],
      ['hour', '4', 'number'],
    ]);
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 13; i++) deep = { nested: deep };
    expect(() => flattenReport(deep)).toThrow();
    expect(() => flattenReport({ ['x'.repeat(257)]: 1 })).toThrow();
    expect(() => flattenReport({ value: undefined })).toThrow();
    expect(() =>
      renderCsv(
        Array.from({ length: 5000 }, () => ['key', 'x'.repeat(1800), '']),
      ),
    ).toThrow();
    expect(
      parseReportQuery('staff', {
        format: 'pdf',
        period: 'month',
        workerId: '67f4568c-89ab-4c12-b321-123456789012',
      }),
    ).toMatchObject({ period: 'month' });
  });
  it('renders a real paginated PDF with embedded Sinhala/Tamil fonts and a title', async () => {
    const pdf = await renderPdf(
      'Worker report',
      '2026-10-01 to 2026-11-01',
      Array.from({ length: 100 }, (_, i) => [
        'worker ' + i,
        '\u0d9a\u0db8\u0dbd\u0dca\u200d \u0ba4\u0bae\u0bbf\u0bb4\u0bcd caf\u00e9 \u0394',
        'count',
      ]),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/Title (Worker report)');
    expect(pdf.toString('latin1')).toMatch(/\/Count [2-9]/);
    expect(pdf.subarray(-20).toString()).toContain('%%EOF');
  });
});
describe('DDP-030 aggregation reuse and admission limits', () => {
  function setup() {
    const summary = jest.fn().mockResolvedValue({
      start: '2026-10-19T18:30:00Z',
      end: '2026-10-20T18:30:00Z',
      total: 2,
      workers: [],
    });
    const calendar = jest.fn().mockResolvedValue({
      from: '2026-10-20',
      to: '2026-10-20',
      rangeEndInclusive: true,
      dates: [],
    });
    const alerts = jest.fn().mockResolvedValue({
      from: '2026-10-20',
      to: '2026-11-02',
      rangeEndInclusive: true,
      alerts: [],
    });
    return {
      summary,
      calendar,
      alerts,
      service: new ReportsService(
        { summary } as unknown as BookingAnalyticsService,
        { summary } as unknown as RevenueAnalyticsService,
        { summary } as unknown as WorkerPerformanceService,
        { summary } as unknown as FoodAnalyticsService,
        { summary } as unknown as ServiceRequestAnalyticsService,
        { calendar } as unknown as OccupancyAnalyticsService,
        { alerts } as unknown as LowBookingAlertsService,
      ),
    };
  }
  it('uses every existing aggregation service with the requested filters', async () => {
    const { service, summary, calendar } = setup();
    for (const type of REPORT_TYPES) {
      const result = await service.download(type, {
        format: 'csv',
        period: 'week',
        from: '2026-10-20',
        to: '2026-10-20',
      });
      expect(result.contentType).toContain('text/csv');
      expect(result.buffer.toString()).toContain('Field');
    }
    expect(summary).toHaveBeenCalledWith('week');
    expect(summary).toHaveBeenCalledWith(
      { period: 'week', workerId: undefined },
      201,
    );
    expect(calendar).toHaveBeenCalledWith({
      from: '2026-10-20',
      to: '2026-10-20',
    });
  });
  it('rejects rather than truncates large worker selections', async () => {
    const { service, summary } = setup();
    summary.mockResolvedValue({ workers: Array(201).fill({}) });
    await expect(
      service.download('staff', { format: 'csv', period: 'day' }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('caps concurrent exports and releases admission after source failures', async () => {
    const { service, summary } = setup();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    summary.mockReturnValue(pending);
    const a = service.download('bookings', { format: 'csv', period: 'day' });
    const b = service.download('revenue', { format: 'csv', period: 'day' });
    await expect(
      service.download('bookings', { format: 'csv', period: 'day' }),
    ).rejects.toMatchObject({ status: 503 });
    finish({ start: '2026-10-20', end: '2026-10-21', total: 0 });
    await Promise.all([a, b]);
    summary.mockRejectedValueOnce(new Error('source'));
    await expect(
      service.download('bookings', { format: 'csv', period: 'day' }),
    ).rejects.toThrow('source');
    summary.mockResolvedValue({ start: '2026-10-20', end: '2026-10-21' });
    expect(
      (await service.download('bookings', { format: 'pdf', period: 'day' }))
        .contentType,
    ).toBe('application/pdf');
  });
});
