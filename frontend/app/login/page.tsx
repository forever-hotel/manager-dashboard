import { LoginForm } from '@/components/LoginForm';
import { backend } from '@/lib/backend';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const health = await backend('/health/ready');

  if (health.status !== 200) {
    const query = new URLSearchParams();

    if (params.next) query.set('next', params.next);
    if (params.reason) query.set('reason', params.reason);
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <section className="w-full max-w-sm rounded-lg border border-border p-8 bg-surface">
          <h1 className="font-medium text-[22px] text-brand">Service unavailable</h1>
          <p className="my-4 text-sm text-muted">We could not connect to the service. Please try again.</p>
          <Link className="underline" href={'/login?' + query.toString()} prefetch={false}>
            Retry
          </Link>
        </section>
      </main>
    );
  }
  return <LoginForm next={params.next} expired={params.reason === 'expired'} />;
}
