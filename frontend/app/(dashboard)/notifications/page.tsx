import NotificationsPanel from '@/components/Notifications';

export default async function Page({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const value = (await searchParams).page;
  const page =
    typeof value === 'string' && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100000
      ? Number(value)
      : 1;
  return <NotificationsPanel initialPage={page} />;
}
