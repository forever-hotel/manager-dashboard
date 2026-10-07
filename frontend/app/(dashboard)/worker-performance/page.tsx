import React from "react";

export default function WorkerPerformancePage() {
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">
          Worker performance
        </h1>
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

      {/* Worker performance stats */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">
          Worker performance
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Tasks completed (today)
            </div>
            <div className="font-medium text-[19px] text-black">38</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Avg completion time
            </div>
            <div className="font-medium text-[19px] text-black mb-1">
              11 min
            </div>
            <div className="font-normal text-[9.5px] text-black/60">
              target: 15 min
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Escalations (today)
            </div>
            <div className="font-medium text-[19px] text-black">2</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">
              Active workers
            </div>
            <div className="font-medium text-[19px] text-black">6</div>
          </div>
        </div>
      </section>

      {/* Per-worker summary + task queue */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {/* Per-worker summary */}
        <section className="border border-gray-200 rounded-lg p-4">
          <h2 className="font-medium text-[11px] text-black mb-4">
            Per-worker summary
          </h2>
          <div className="space-y-4">
            {[
              {
                initials: "SK",
                name: "S. Kumari",
                detail: "Housekeeping · 9 tasks completed · avg 10 min",
                tag: "Top",
              },
              {
                initials: "PR",
                name: "P. Ratna",
                detail: "Maintenance · 7 tasks · avg 13 min",
                tag: "Good",
              },
              {
                initials: "NP",
                name: "N. Peris",
                detail: "Housekeeping · 5 tasks · avg 14 min",
                tag: "Avg",
              },
              {
                initials: "KF",
                name: "K. Fernando",
                detail: "Maintenance · 3 tasks · avg 18 min · 1 complaint",
                tag: "Low",
              },
            ].map((w) => (
              <div key={w.initials} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="font-medium text-[10px] text-black">
                    {w.initials}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[10.5px] text-black">
                    {w.name}
                  </div>
                  <div className="font-normal text-[9px] text-black/60">
                    {w.detail}
                  </div>
                </div>
                <span className="font-medium text-[8.5px] text-black bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
                  {w.tag}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Worker task queue */}
        <section className="col-span-2 border border-gray-200 rounded-lg p-4">
          <h2 className="font-medium text-[11px] text-black mb-3">
            Worker task queue (read-only WKMS view)
          </h2>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                {["Task ID", "Room", "Type", "Waiting", "Worker", "Status"].map(
                  (h) => (
                    <th
                      key={h}
                      className="font-medium text-[9.5px] text-black py-2"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {[
                {
                  id: "#T-291",
                  room: "204",
                  type: "Extra towels",
                  waiting: "4 min",
                  worker: "S. Kumari",
                  status: "In progress",
                },
                {
                  id: "#T-290",
                  room: "108",
                  type: "Maintenance",
                  waiting: "18 min",
                  worker: "—",
                  status: "Escalated",
                },
                {
                  id: "#T-289",
                  room: "306",
                  type: "Cleaning",
                  waiting: "7 min",
                  worker: "N. Peris",
                  status: "In progress",
                },
                {
                  id: "#T-288",
                  room: "101",
                  type: "Delivery",
                  waiting: "2 min",
                  worker: "P. Ratna",
                  status: "Assigned",
                },
              ].map((row, i, arr) => (
                <tr
                  key={row.id}
                  className={
                    i < arr.length - 1 ? "border-b border-gray-100" : ""
                  }
                >
                  <td className="text-[10px] text-black py-2">{row.id}</td>
                  <td className="text-[10px] text-black py-2">{row.room}</td>
                  <td className="text-[10px] text-black py-2">{row.type}</td>
                  <td className="text-[10px] text-black py-2">{row.waiting}</td>
                  <td className="text-[10px] text-black py-2">{row.worker}</td>
                  <td className="py-2">
                    <span className="font-medium text-[9px] text-black bg-gray-100 rounded-full px-2 py-1">
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex gap-3 mt-4">
            <button className="font-normal text-[10.5px] text-black bg-gray-100 rounded-md px-4 py-2">
              Export PDF
            </button>
            <button className="font-normal text-[10.5px] text-black border border-gray-200 rounded-md px-4 py-2">
              Export CSV
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
