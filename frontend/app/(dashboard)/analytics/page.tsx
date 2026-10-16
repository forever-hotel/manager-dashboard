import AnalyticsDashboard from '@/components/AnalyticsDashboard';

import OccupancyCalendar from '@/components/OccupancyCalendar';
import { hotelMonth } from '@/lib/occupancy';

export default function AnalyticsPage() {
  return (
    <AnalyticsDashboard>
      <OccupancyCalendar initialMonth={hotelMonth()} />
    </AnalyticsDashboard>
  );
}
