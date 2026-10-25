export const csv = '\ufeff"Field","Value","Unit"\r\n"total","0","count"\r\n';
export function reportResponse(format = 'csv', type = 'bookings') {
  return new Response(format === 'pdf' ? '%PDF-1.7\nbody\n%%EOF\n' : csv, {
    headers: {
      'Content-Type': format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${type}-2026-10-21.${format}"`
    }
  });
}
