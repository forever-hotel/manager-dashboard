export function SectionPlaceholder({ title }: { title: string }) {
  return (
    <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">
      <h1 className="mb-6 font-medium text-[22px] text-brand">{title}</h1>
      <section className="rounded-lg border border-border p-5 bg-surface">
        <h2 className="font-medium text-base text-ink">Coming soon</h2>
        <p className="mt-2 text-sm text-muted">This section is not available yet.</p>
      </section>
    </main>
  );
}
