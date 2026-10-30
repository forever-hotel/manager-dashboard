import { requireSession } from '@/lib/session';
import { ClientLayout } from '@/components/ClientLayout';
import { NotificationsProvider } from '@/components/Notifications';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <NotificationsProvider key={session.sub}>
      <ClientLayout session={session}>{children}</ClientLayout>
    </NotificationsProvider>
  );
}
