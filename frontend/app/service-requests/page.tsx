import React from "react";

export default function ServiceRequestsPage() {
  const rows = [
    { id: "#SR-441", room: "204", cat: "Extra towels", time: "14:32", assigned: "K. Banda", status: "In progress" },
    { id: "#SR-440", room: "108", cat: "Maintenance", time: "14:18", assigned: "Unassigned", status: "Escalated" },
    { id: "#SR-439", room: "306", cat: "Room cleaning", time: "13:55", assigned: "S. Kumari", status: "In progress" },
    { id: "#SR-438", room: "101", cat: "Water bottles", time: "13:40", assigned: "K. Banda", status: "Completed" },
    { id: "#SR-437", room: "202", cat: "Laundry", time: "13:22", assigned: "P. Ratna", status: "Completed" },
  ];

  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Service requests</h1>
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

      {/* Analytics */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">Service request analytics</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Requests today</div>
            <div className="font-medium text-[19px] text-black">22</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Resolved</div>
            <div className="font-medium text-[19px] text-black mb-1">17</div>
            <div className="font-normal text-[9.5px] text-black/60">77%</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Unresolved</div>
            <div className="font-medium text-[19px] text-black">5</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Avg resolution</div>
            <div className="font-medium text-[19px] text-black">12 min</div>
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="mb-10">
        <h2 className="font-medium text-[12px] text-black mb-3">Active service requests</h2>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {["Request ID","Room","Category","Submitted","Assigned to","Status"].map((h) => (
                  <th key={h} className="font-medium text-[10.5px] text-black px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i, arr) => (
                <tr key={row.id} className={i < arr.length - 1 ? "border-b border-gray-100" : ""}>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.id}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.room}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.cat}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.time}</td>
                  <td className="text-[10.5px] text-black px-4 py-3">{row.assigned}</td>
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
