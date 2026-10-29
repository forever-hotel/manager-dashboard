import { ChangePasswordForm } from '@/components/ChangePasswordForm';
import { requireSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { safeDestination } from '@/lib/auth';
export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await requireSession(true);
  const { next } = await searchParams;
  if (!session.passwordChangeRequired) redirect(safeDestination(next));
  return <ChangePasswordForm next={next} />;
}
