import Link from 'next/link';
import { safeDestination } from '@/lib/auth';
export default async function Unavailable({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Service unavailable</h1>
      <p className="my-4">
        We could not connect to the service. Please try again.
      </p>
      <Link
        className="underline"
        href={safeDestination((await searchParams).next)}
      >
        Retry
      </Link>
    </main>
  );
}
