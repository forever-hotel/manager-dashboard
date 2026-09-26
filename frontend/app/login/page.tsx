import { AuthForm } from '@/components/AuthForm';
import { backend } from '@/lib/backend';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default async function LoginPage({
  searchParams,
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
      <main className="flex min-h-screen items-center justify-center bg-white p-4">
        <section className="w-full max-w-sm rounded-lg border border-gray-200 p-8">
          <h1 className="text-xl font-semibold">Service unavailable</h1>
          <p className="my-4 text-sm text-gray-600">
            We could not connect to the service. Please try again.
          </p>
          <Link
            className="underline"
            href={'/login?' + query.toString()}
            prefetch={false}
          >
            Retry
          </Link>
        </section>
      </main>
    );
  }
  return <AuthForm next={params.next} expired={params.reason === 'expired'} />;
}
