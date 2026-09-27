import { AuthForm } from '@/components/AuthForm';
import { requireSession } from '@/lib/session';
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await requireSession(true);
  return <AuthForm changePassword next={(await searchParams).next} />;
}
