import React from "react";

export default function FoodOrdersPage() {
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Food orders</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
            <button className="font-normal text-[10.5px] text-black px-3 py-1 rounded">Day</button>
            <button className="font-medium text-[10.5px] text-black px-3 py-1 rounded bg-white shadow-sm">Week</button>
            <button className="font-normal text-[10.5px] text-black px-3 py-1 rounded">Month</button>
          </div>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>

      {/* Analytics cards */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">Food order analytics</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Orders today</div>
            <div className="font-medium text-[19px] text-black mb-1">47</div>
            <div className="font-normal text-[9.5px] text-black/60">+5 vs yesterday</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Pending in kitchen</div>
            <div className="font-medium text-[19px] text-black mb-1">8</div>
            <div className="font-normal text-[9.5px] text-black/60">3 near cutoff</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Avg delivery time</div>
            <div className="font-medium text-[19px] text-black mb-1">18 min</div>
            <div className="font-normal text-[9.5px] text-black/60">target: 20 min</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Revenue (food)</div>
            <div className="font-medium text-[19px] text-black mb-1">LKR 84K</div>
            <div className="font-normal text-[9.5px] text-black/60">+12%</div>
          </div>
        </div>
      </section>

      {/* Kitchen queue + top items */}
      <div className="grid grid-cols-3 gap-4 mb-10">

        {/* Kitchen queue (live) : spans 2 cols */}
        <section className="col-span-2 border border-gray-200 rounded-lg p-4">
          <h2 className="font-medium text-[11.5px] text-black mb-3">Kitchen queue (live)</h2>
          <div className="grid grid-cols-3 gap-3">

            {/* New */}
            <div className="bg-gray-50 rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-[10px] text-black">New</span>
                <span className="font-medium text-[9.5px] text-black bg-white border border-gray-200 rounded-full w-5 h-5 flex items-center justify-center">3</span>
              </div>
              <div className="space-y-2">
                <div className="bg-white rounded-md p-2.5 border border-gray-100">
                  <div className="font-medium text-[10.5px] text-black">Room 204</div>
                  <div className="font-normal text-[9px] text-black/60">Dinner · 3 items · 6 min ago</div>
                  <span className="font-medium text-[9px] text-black">Allergen</span>
                </div>
                <div className="bg-white rounded-md p-2.5 border border-gray-100">
                  <div className="font-medium text-[10.5px] text-black">Room 108</div>
                  <div className="font-normal text-[9px] text-black/60">Dinner · 2 items · 2 min ago</div>
                </div>
                <div className="bg-white rounded-md p-2.5 border border-gray-100">
                  <div className="font-medium text-[10.5px] text-black">Room 306</div>
                  <div className="font-normal text-[9px] text-black/60">Tea time · 1 item · just now</div>
                </div>
              </div>
            </div>

            {/* Preparing */}
            <div className="bg-gray-50 rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-[10px] text-black">Preparing</span>
                <span className="font-medium text-[9.5px] text-black bg-white border border-gray-200 rounded-full w-5 h-5 flex items-center justify-center">3</span>
              </div>
              <div className="space-y-2">
                <div className="bg-white rounded-md p-2.5 border border-gray-100">
                  <div className="font-medium text-[10.5px] text-black">Room 101</div>
                  <div className="font-normal text-[9px] text-black/60">Lunch · 4 items · 14 min</div>
                </div>
                <div className="bg-white rounded-md p-2.5 border border-gray-100">
                  <div className="font-medium text-[10.5px] text-black">Room 202</div>
                  <div className="font-normal text-[9px] text-black/60">Lunch · 2 items · 10 min</div>
                </div>
                <div className="bg-white rounded-md p-2.5 border border-gray-100">
                  <div className="font-medium text-[10.5px] text-black">Room 303</div>
                  <div className="font-normal text-[9px] text-black/60">Lunch · 1 item · 8 min</div>
                </div>
              </div>
            </div>

            {/* Ready */}
            <div className="bg-gray-50 rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-[10px] text-black">Ready</span>
                <span className="font-medium text-[9.5px] text-black bg-white border border-gray-200 rounded-full w-5 h-5 flex items-center justify-center">2</span>
              </div>
              <div className="space-y-2">
                <div className="bg-white rounded-md p-2.5 border border-gray-100">
                  <div className="font-medium text-[10.5px] text-black">Room 105</div>
                  <div className="font-normal text-[9px] text-black/60">Lunch · awaiting delivery</div>
                </div>
                <div className="bg-white rounded-md p-2.5 border border-gray-100">
                  <div className="font-medium text-[10.5px] text-black">Room 307</div>
                  <div className="font-normal text-[9px] text-black/60">Breakfast · awaiting delivery</div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* Top ordered items */}
        <section className="border border-gray-200 rounded-lg p-4">
          <h2 className="font-medium text-[11px] text-black mb-3">Top ordered items (week)</h2>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="font-medium text-[9.5px] text-black py-2">Item</th>
                <th className="font-medium text-[9.5px] text-black py-2">Category</th>
                <th className="font-medium text-[9.5px] text-black py-2 text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {[
                { item: "Grilled chicken", cat: "Lunch", orders: 42 },
                { item: "Club sandwich", cat: "Lunch", orders: 38 },
                { item: "Egg hoppers", cat: "Breakfast", orders: 35 },
                { item: "Fried rice", cat: "Dinner", orders: 29 },
                { item: "Chocolate cake", cat: "Tea-Time", orders: 24 },
              ].map((r, i, arr) => (
                <tr key={r.item} className={i < arr.length - 1 ? "border-b border-gray-100" : ""}>
                  <td className="text-[10px] text-black py-2">{r.item}</td>
                  <td className="text-[10px] text-black py-2">{r.cat}</td>
                  <td className="text-[10px] text-black py-2 text-right">{r.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
