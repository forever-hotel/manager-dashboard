'use client';
import { type ReactNode } from 'react';
import { type Period } from '@/lib/analytics';
import { PeriodButtons } from './AnalyticsControls';
import HeaderNotifications from './HeaderNotifications';

export function PageHeader({
  title,
  period,
  onPeriodChange
}: {
  title: string;
  period: Period;
  onPeriodChange: (period: Period) => void;
}) {
  return (
    <div className="page-topbar">
      <h1>{title}</h1>
      <div className="header-actions">
        <PeriodButtons period={period} onChange={onPeriodChange} />
        <HeaderNotifications />
      </div>
    </div>
  );
}

export function SummaryCard({
  label,
  value,
  tone = 'brand',
  note
}: {
  label: string;
  value: string;
  tone?: 'brand' | 'success' | 'danger' | 'warning';
  note?: string;
}) {
  return (
    <div className="summary-card" title={note}>
      <div className="summary-label">{label}</div>
      <div className={'summary-value summary-' + tone}>{value}</div>
      {note && <div className="summary-note">{note}</div>}
    </div>
  );
}

export function DataPanel({
  title,
  actions,
  children,
  className = ''
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'data-panel ' + className}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function UnavailableRow({ columns, message }: { columns: number; message: string }) {
  return (
    <tr>
      <td colSpan={columns} className="unavailable-row">
        {message}
      </td>
    </tr>
  );
}
