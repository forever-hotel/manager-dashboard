import { requireSession } from '@/lib/session';
import { ClientLayout } from '@/components/ClientLayout';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  return <ClientLayout session={session}>{children}</ClientLayout>;
}
