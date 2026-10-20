import React from 'react';
import KitchenQueue from '@/components/KitchenQueue';

export default function FoodOrdersPage() {
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Food orders</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
            <button className="font-normal text-[10.5px] text-black px-3 py-1 rounded">
              Day
            </button>
            <button className="font-medium text-[10.5px] text-black px-3 py-1 rounded bg-white shadow-sm">
              Week
            </button>
            <button className="font-normal text-[10.5px] text-black px-3 py-1 rounded">
              Month
            </button>
          </div>
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="black"
            strokeWidth="1.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      </div>

      {/* Analytics cards */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">
          Food order analytics
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Orders today
            </div>
            <div className="font-medium text-[19px] text-black mb-1">47</div>
            <div className="font-normal text-[9.5px] text-black/60">
              +5 vs yesterday
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Pending in kitchen
            </div>
            <div className="font-medium text-[19px] text-black mb-1">8</div>
            <div className="font-normal text-[9.5px] text-black/60">
              3 near cutoff
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Avg delivery time
            </div>
            <div className="font-medium text-[19px] text-black mb-1">
              18 min
            </div>
            <div className="font-normal text-[9.5px] text-black/60">
              target: 20 min
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Revenue (food)
            </div>
            <div className="font-medium text-[19px] text-black mb-1">
              LKR 84K
            </div>
            <div className="font-normal text-[9.5px] text-black/60">+12%</div>
          </div>
        </div>
      </section>

      {/* Kitchen queue + top items */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {/* Kitchen queue (live) : spans 2 cols */}
        <KitchenQueue />

        {/* Top ordered items */}
        <section className="border border-gray-200 rounded-lg p-4">
          <h2 className="font-medium text-[11px] text-black mb-3">
            Top ordered items (week)
          </h2>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="font-medium text-[9.5px] text-black py-2">
                  Item
                </th>
                <th className="font-medium text-[9.5px] text-black py-2">
                  Category
                </th>
                <th className="font-medium text-[9.5px] text-black py-2 text-right">
                  Orders
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { item: 'Grilled chicken', cat: 'Lunch', orders: 42 },
                { item: 'Club sandwich', cat: 'Lunch', orders: 38 },
                { item: 'Egg hoppers', cat: 'Breakfast', orders: 35 },
                { item: 'Fried rice', cat: 'Dinner', orders: 29 },
                { item: 'Chocolate cake', cat: 'Tea-Time', orders: 24 },
              ].map((r, i, arr) => (
                <tr
                  key={r.item}
                  className={
                    i < arr.length - 1 ? 'border-b border-gray-100' : ''
                  }
                >
                  <td className="text-[10px] text-black py-2">{r.item}</td>
                  <td className="text-[10px] text-black py-2">{r.cat}</td>
                  <td className="text-[10px] text-black py-2 text-right">
                    {r.orders}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
