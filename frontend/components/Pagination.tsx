'use client';

export default function Pagination({
  page,
  pageSize,
  total,
  noun,
  onChange,
  disabled = false,
  suffix = ''
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onChange: (page: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <nav className="booking-pagination" aria-label={noun + ' pagination'}>
      <span>
        {total ? Math.min((page - 1) * pageSize + 1, total) : 0}&ndash;{Math.min(page * pageSize, total)} of {total}{' '}
        {noun}
        {suffix}
      </span>
      <button
        type="button"
        className="button button-secondary"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous {noun}
      </button>
      <button
        type="button"
        className="button button-secondary"
        disabled={disabled || page * pageSize >= total}
        onClick={() => onChange(page + 1)}
      >
        Next {noun}
      </button>
    </nav>
  );
}
