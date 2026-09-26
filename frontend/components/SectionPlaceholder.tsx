export function SectionPlaceholder({ title }: { title: string }) {
  return (
    <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
      <h1 className="mb-6 text-[15px] font-medium text-black">{title}</h1>
      <section className="rounded-lg border border-gray-200 p-5">
        <h2 className="text-[12px] font-medium text-black">Coming soon</h2>
        <p className="mt-2 text-sm text-black/60">
          This section is not available yet.
        </p>
      </section>
    </main>
  );
}
