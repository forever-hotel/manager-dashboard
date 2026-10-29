'use client';
import { useState } from 'react';
import { hotelMonth, monthDates } from '@/lib/occupancy';
import { reportTypes, reportLabels, reportQuery, type ReportType, type ReportFilters } from '@/lib/reports';
import ReportDownload from './ReportDownload';
import HeaderNotifications from './HeaderNotifications';
export default function ReportsIndex() {
  const dates = monthDates(hotelMonth());
  const [type, setType] = useState<ReportType>('bookings');
  const [period, setPeriod] = useState('week');
  const [date, setDate] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [from, setFrom] = useState(dates[0]);
  const [to, setTo] = useState(dates.at(-1)!);
  const filters: ReportFilters =
    type === 'occupancy'
      ? { from, to }
      : type === 'low-booking-alerts'
        ? {}
        : {
            period,
            ...(['bookings', 'revenue', 'food-orders', 'service-requests'].includes(type) && date ? { date } : {}),
            ...(['worker-performance', 'staff'].includes(type) && workerId.trim() ? { workerId: workerId.trim() } : {})
          };
  let valid = true;
  try {
    reportQuery(type, new URLSearchParams({ ...filters, format: 'csv' } as Record<string, string>));
  } catch {
    valid = false;
  }
  const control = 'block border border-border rounded-md px-3 py-2 font-normal text-[13px] text-ink';
  return (
    <main className="dashboard-page reports-page">
      <div className="page-topbar">
        <h1>Reports</h1>
        <HeaderNotifications />
      </div>
      <p className="section-eyebrow">Hotel reports</p>
      <section className="data-panel reports-selection">
        <div className="panel-heading">
          <h2>Download analytical reports</h2>
        </div>
        <div className="reports-form-body">
          <div className="reports-filter-grid">
            <label>
              Report
              <select value={type} onChange={e => setType(e.target.value as ReportType)} className={control}>
                {reportTypes.map(t => (
                  <option key={t} value={t}>
                    {reportLabels[t]}
                  </option>
                ))}
              </select>
            </label>
            {type === 'occupancy' ? (
              <>
                <label>
                  From date
                  <input type="date" className={control} value={from} onChange={e => setFrom(e.target.value)} />
                </label>
                <label>
                  To date
                  <input type="date" className={control} value={to} onChange={e => setTo(e.target.value)} />
                </label>
              </>
            ) : type !== 'low-booking-alerts' ? (
              <label>
                Period
                <select className={control} value={period} onChange={e => setPeriod(e.target.value)}>
                  {['day', 'week', 'month'].map(p => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {['bookings', 'revenue', 'food-orders', 'service-requests'].includes(type) && (
              <label>
                Period date (optional)
                <input type="date" value={date} onChange={event => setDate(event.target.value)} className={control} />
              </label>
            )}
            {['worker-performance', 'staff'].includes(type) && (
              <label>
                Worker ID (optional)
                <input className={control} value={workerId} onChange={e => setWorkerId(e.target.value)} />
              </label>
            )}
          </div>
          <p className="text-xs text-muted">
            Asia/Colombo calendar periods. Occupancy dates include both endpoints (maximum 366 days). Low-booking alerts
            cover the next 14 days. Downloads contain the full matching analytics summary.
          </p>
          {!valid && (
            <p role="alert" className="text-xs text-danger mt-3">
              Check the worker ID or use a valid ordered date range of up to 366 days.
            </p>
          )}
        </div>
        <div className="reports-download-panel">
          <div>
            <h3>{reportLabels[type]}</h3>
            <p>PDF document or CSV spreadsheet, using the filters selected above.</p>
          </div>
          <ReportDownload type={type} filters={filters} disabled={!valid} />
        </div>
      </section>
    </main>
  );
}
