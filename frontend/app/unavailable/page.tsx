import { safeDestination } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Unavailable({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const destination = safeDestination((await searchParams).next);

  return (
    <main className="p-8">
      <h1 className="font-medium text-[22px] text-brand">Service unavailable</h1>
      <p className="my-4">We could not connect to the service. Please try again.</p>
      {/* Recover with a fresh document, not the client router state that failed. */}
      <a className="underline" href={destination}>
        Retry
      </a>
    </main>
  );
}
