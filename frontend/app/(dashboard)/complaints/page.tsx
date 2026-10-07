import React from "react";

export default function ComplaintsPage() {
  const rows = [
    { id: "#CP-031", room: "204", cat: "Slow service", sev: "High", time: "10 Apr 14:10", ref: "K. Banda", status: "Open", action: "Resolve" },
    { id: "#CP-030", room: "108", cat: "Room condition", sev: "Med", time: "10 Apr 11:30", ref: "S. Kumari", status: "Review", action: "Update" },
    { id: "#CP-029", room: "306", cat: "Food quality", sev: "High", time: "9 Apr 20:15", ref: "—", status: "Open", action: "Resolve" },
    { id: "#CP-028", room: "101", cat: "Noise", sev: "Low", time: "9 Apr 18:00", ref: "—", status: "Review", action: "Update" },
    { id: "#CP-027", room: "202", cat: "Billing error", sev: "High", time: "9 Apr 09:45", ref: "—", status: "Open", action: "Resolve" },
  ];

  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Complaints</h1>
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

      {/* Stats */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">Complaint register</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Open complaints</div>
            <div className="font-medium text-[19px] text-black">3</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Under review</div>
            <div className="font-medium text-[19px] text-black">4</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Resolved (month)</div>
            <div className="font-medium text-[19px] text-black">18</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Avg resolution</div>
            <div className="font-medium text-[19px] text-black">6.2 hrs</div>
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="mb-10">
        <h2 className="font-medium text-[12px] text-black mb-3">Complaint register</h2>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {["ID","Room","Category","Severity","Submitted","Worker ref","Status","Action"].map((h) => (
                  <th key={h} className="font-medium text-[10.5px] text-black px-3 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i, arr) => (
                <tr key={row.id} className={i < arr.length - 1 ? "border-b border-gray-100" : ""}>
                  <td className="text-[10.5px] text-black px-3 py-3">{row.id}</td>
                  <td className="text-[10.5px] text-black px-3 py-3">{row.room}</td>
                  <td className="text-[10.5px] text-black px-3 py-3">{row.cat}</td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-[9.5px] text-black bg-gray-100 rounded-full px-2 py-1">{row.sev}</span>
                  </td>
                  <td className="text-[10.5px] text-black px-3 py-3">{row.time}</td>
                  <td className="text-[10.5px] text-black px-3 py-3">{row.ref}</td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-[9.5px] text-black bg-gray-100 rounded-full px-2 py-1">{row.status}</span>
                  </td>
                  <td className="px-3 py-3">
                    <button className="font-normal text-[10px] text-black underline">{row.action}</button>
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
