'use client';

import FoodAnalytics from './FoodAnalytics';
import ServiceAnalytics from './ServiceAnalytics';

export default function OperationsAnalytics({ type }: { type: 'food-orders' | 'service-requests' }) {
  return type === 'food-orders' ? <FoodAnalytics /> : <ServiceAnalytics />;
}
