import TaskQueue from '@/components/TaskQueue';

export default function Page() {
  return (
    <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
      <h1 className="mb-6 text-[15px] font-medium text-black">Tasks</h1>
      <TaskQueue />
    </main>
  );
}
