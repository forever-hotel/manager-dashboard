import { z } from 'zod';
import ComplaintsDashboard from '@/components/ComplaintsDashboard';

export default async function ComplaintsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const worker = z.uuid().safeParse(query.workerId);
  const complaint = z.uuid().safeParse(query.complaintId);
  const status = z.enum(['SUBMITTED', 'UNDER_REVIEW', 'RESOLVED']).safeParse(query.status);

  return (
    <ComplaintsDashboard
      key={
        (worker.success ? worker.data : '') +
        ':' +
        (status.success ? status.data : '') +
        ':' +
        (complaint.success ? complaint.data : '')
      }
      initialWorkerId={worker.success ? worker.data : ''}
      initialStatus={status.success ? status.data : ''}
      initialComplaintId={complaint.success ? complaint.data : undefined}
    />
  );
}
