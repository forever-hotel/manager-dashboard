import Link from 'next/link';
import TaskQueue from '@/components/TaskQueue';
import HeaderNotifications from '@/components/HeaderNotifications';

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const fromWorker = (await searchParams).from === 'worker-performance';

  return (
    <main className="dashboard-page">
      <div className="page-topbar">
        <h1>Tasks</h1>
        <HeaderNotifications />
      </div>
      {fromWorker && (
        <Link href="/worker-performance" className="button button-secondary mb-4">
          Back to Worker Performance
        </Link>
      )}
      <TaskQueue />
    </main>
  );
}
