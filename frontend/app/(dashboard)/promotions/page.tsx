import PromotionsDashboard from '@/components/PromotionsDashboard';
import { promotionDates } from '@/lib/low-demand';

export default async function PromotionsPage({
  searchParams
}: {
  searchParams: Promise<{ lowDemandDate?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <PromotionsDashboard
      initialDate={
        typeof query.lowDemandDate === 'string' && promotionDates(query.lowDemandDate) ? query.lowDemandDate : undefined
      }
    />
  );
}
