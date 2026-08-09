import React from "react";

export default function PromotionsPage() {
  const promos = [
    { code: "SUMMER20", discount: "20%", until: "30 Apr", used: "32 / 100", rooms: "All", status: "Active" },
    { code: "WEEKEND15", discount: "15%", until: "30 Apr", used: "8 / 50", rooms: "Suite", status: "Active" },
    { code: "EARLYBIRD", discount: "LKR 5,000", until: "15 Apr", used: "50 / 50", rooms: "Deluxe", status: "Expired" },
  ];

  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Promotions</h1>
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

      {/* Create promotion form */}
      <section className="mb-8">
        <h2 className="font-medium text-[12px] underline text-black mb-3">Promotion management</h2>
        <div className="border border-gray-200 rounded-lg p-5">
          <h3 className="font-medium text-[11.5px] text-black mb-4">Create new promotion</h3>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="font-normal text-[10px] text-black/60 block mb-1">Promo code</label>
              <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                <span className="font-normal text-[11.5px] text-black">APRIL25</span>
              </div>
            </div>
            <div>
              <label className="font-normal text-[10px] text-black/60 block mb-1">Discount type</label>
              <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                <span className="font-normal text-[11px] text-black">Percentage (%)</span>
              </div>
            </div>
            <div>
              <label className="font-normal text-[10px] text-black/60 block mb-1">Discount value</label>
              <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                <span className="font-normal text-[11px] text-black">25</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="font-normal text-[10px] text-black/60 block mb-1">Valid from</label>
              <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                <span className="font-normal text-[11px] text-black">2026-04-10</span>
              </div>
            </div>
            <div>
              <label className="font-normal text-[10px] text-black/60 block mb-1">Valid until</label>
              <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                <span className="font-normal text-[11px] text-black">2026-04-30</span>
              </div>
            </div>
            <div>
              <label className="font-normal text-[10px] text-black/60 block mb-1">Max redemptions</label>
              <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                <span className="font-normal text-[11px] text-black">50</span>
              </div>
            </div>
          </div>

          <div className="mb-5">
            <label className="font-normal text-[10px] text-black/60 block mb-1">Applicable room types</label>
            <div className="w-full border border-gray-200 rounded-md px-3 py-2">
              <span className="font-normal text-[11.5px] text-black">Deluxe King, Suite</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button className="font-normal text-[11px] text-black bg-gray-100 rounded-md px-4 py-2">Save &amp; activate</button>
            <button className="font-normal text-[11px] text-black border border-gray-200 rounded-md px-4 py-2">Save as draft</button>
          </div>
        </div>
      </section>

      {/* Active promotions table */}
      <section className="mb-10">
        <h2 className="font-medium text-[12px] text-black mb-3">Active promotions</h2>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {["Code","Discount","Valid until","Used / Max","Rooms","Status","Actions"].map((h) => (
                  <th key={h} className="font-medium text-[10.5px] text-black px-3 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {promos.map((p, i, arr) => (
                <tr key={p.code} className={i < arr.length - 1 ? "border-b border-gray-100" : ""}>
                  <td className="text-[10.5px] text-black px-3 py-3">{p.code}</td>
                  <td className="text-[10.5px] text-black px-3 py-3">{p.discount}</td>
                  <td className="text-[10.5px] text-black px-3 py-3">{p.until}</td>
                  <td className="text-[10.5px] text-black px-3 py-3">{p.used}</td>
                  <td className="text-[10.5px] text-black px-3 py-3">{p.rooms}</td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-[9.5px] text-black bg-gray-100 rounded-full px-2 py-1">{p.status}</span>
                  </td>
                  <td className="px-3 py-3">
                    {p.status === "Expired" ? (
                      <button className="font-normal text-[10px] text-black underline">Delete</button>
                    ) : (
                      <>
                        <button className="font-normal text-[10px] text-black underline">Edit</button>
                        <span className="text-[10px] text-black mx-1">·</span>
                        <button className="font-normal text-[10px] text-black underline">Deactivate</button>
                      </>
                    )}
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
