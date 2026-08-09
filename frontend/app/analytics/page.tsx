import React from "react";

export default function AnalyticsPage() {
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Analytics</h1>
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

      {/* Booking & revenue */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">Booking &amp; revenue</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Total bookings (week)</div>
            <div className="font-medium text-[20px] text-black mb-1">84</div>
            <div className="font-normal text-[9.5px] text-black/60">+12% vs last week</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Revenue (week)</div>
            <div className="font-medium text-[20px] text-black mb-1">LKR 1.24M</div>
            <div className="font-normal text-[9.5px] text-black/60">+8% vs last week</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Occupancy rate</div>
            <div className="font-medium text-[20px] text-black mb-1">73%</div>
            <div className="font-normal text-[9.5px] text-black/60">-4% vs last week</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Avg length of stay</div>
            <div className="font-medium text-[20px] text-black mb-1">2.4 nights</div>
            <div className="font-normal text-[9.5px] text-black/60">stable</div>
          </div>
        </div>
      </section>

      {/* Alert banner */}
      <div className="flex items-center gap-3 w-full rounded-md bg-amber-50 border border-amber-200 px-4 py-3 mb-6">
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008ZM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="font-normal text-[10.5px] text-black">Low demand detected on Tue 15 &amp; Wed 16 Apr — consider creating a promotion to boost bookings.</span>
      </div>

      {/* Bookings per day */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-[12px] text-black">Bookings per day</h2>
          <button className="font-medium text-[10px] text-black underline">Export CSV</button>
        </div>
        <div className="border border-gray-200 rounded-lg p-5">
          <div className="flex items-end justify-between gap-4 h-[140px]">
            {[
              { val: 14, day: "Mon", h: 89 },
              { val: 8, day: "Tue", h: 51 },
              { val: 6, day: "Wed", h: 38 },
              { val: 16, day: "Thu", h: 102 },
              { val: 18, day: "Fri", h: 114 },
              { val: 22, day: "Sat", h: 140 },
              { val: 20, day: "Sun", h: 127 },
            ].map((b) => (
              <div key={b.day} className="flex flex-col items-center gap-2 flex-1">
                <div className="w-full bg-gray-800 rounded-t" style={{ height: b.h }} />
                <span className="font-normal text-[9.5px] text-black">{b.val}</span>
                <span className="font-normal text-[9.5px] text-black/60">{b.day}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Occupancy heatmap */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-[12px] text-black">Occupancy heatmap — Apr</h2>
          <div className="flex items-center gap-4">
            <span className="font-medium text-[10px] text-black">Legend</span>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#b5d4f4" }} />
              <span className="font-normal text-[9.5px] text-black">Low</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#185fa5" }} />
              <span className="font-normal text-[9.5px] text-black">High</span>
            </div>
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg p-5">
          <div className="grid grid-cols-7 gap-2 mb-2">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="font-normal text-[10px] text-center text-black">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {[
              "#b5d4f4","#85b7eb","#b5d4f4","#85b7eb","#378add","#185fa5","#185fa5",
              "#85b7eb","#b5d4f4","#b5d4f4","#85b7eb","#378add","#185fa5","#378add",
              "#85b7eb","gray","gray","#85b7eb","#378add","#185fa5","#378add",
              "#85b7eb","#85b7eb","#378add","#378add","#185fa5","#185fa5","#378add",
            ].map((color, i) => (
              <div
                key={i}
                className={`h-8 rounded ${color === "gray" ? "bg-gray-100" : ""}`}
                style={color !== "gray" ? { backgroundColor: color } : {}}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Recent bookings */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-[12px] text-black">Recent bookings</h2>
          <button className="font-medium text-[10px] text-black underline">Export PDF</button>
        </div>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {["Booking ID","Guest","Room type","Check-in","Check-out","Amount (LKR)","Source","Status"].map((h) => (
                  <th key={h} className="font-medium text-[10.5px] text-black px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { id:"#BK-0091", guest:"A. Perera", type:"Deluxe King", in:"12 Apr", out:"14 Apr", amt:"42,000", src:"Website", status:"Confirmed" },
                { id:"#BK-0090", guest:"S. Fernando", type:"Superior Twin", in:"11 Apr", out:"13 Apr", amt:"28,500", src:"Booking.lk", status:"Checked in" },
                { id:"#BK-0089", guest:"R. Jayawardena", type:"Suite", in:"10 Apr", out:"12 Apr", amt:"78,000", src:"Walk-in", status:"Checked in" },
                { id:"#BK-0088", guest:"M. Silva", type:"Deluxe King", in:"9 Apr", out:"11 Apr", amt:"42,000", src:"Website", status:"Checked out" },
                { id:"#BK-0087", guest:"D. Ranasinghe", type:"Standard", in:"8 Apr", out:"10 Apr", amt:"18,000", src:"Website", status:"Cancelled" },
              ].map((row, i, arr) => (
                <tr key={row.id} className={i < arr.length - 1 ? "border-b border-gray-100" : ""}>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.id}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.guest}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.type}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.in}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.out}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.amt}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.src}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-[9.5px] text-black bg-gray-100 rounded-full px-2 py-1">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
