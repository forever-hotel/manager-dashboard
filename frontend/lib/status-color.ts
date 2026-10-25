// Presentation only: never use a badge color to decide authorization or workflow state.
export function statusColor(value: string): string {
  const status = value.toUpperCase();
  if (['ACTIVE', 'RESOLVED', 'COMPLETED', 'DELIVERED', 'AVAILABLE', 'CHECKED_IN', 'LOW'].includes(status))
    return 'border-success/30 bg-success-light text-success';
  if (['DELETED', 'CANCELLED', 'FAILED', 'UNAVAILABLE', 'TEMPORARILY_DISABLED', 'HIGH', 'ESCALATED'].includes(status))
    return 'border-danger/30 bg-danger-light text-danger';
  if (
    ['PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'SCHEDULED', 'EXHAUSTED', 'LOW_STOCK', 'IN_PROGRESS', 'MEDIUM'].includes(
      status
    )
  )
    return 'border-warning/30 bg-warning-light text-warning';
  if (['ASSIGNED', 'CONFIRMED', 'PLACED', 'IN_PREPARATION', 'READY'].includes(status))
    return 'border-brand/30 bg-brand-light text-brand';
  return 'border-border bg-surface-alt text-muted';
}
