import React from "react";

const staff = [
  { initials: "KP", name: "K. Perera", role: "Receptionist", email: "k.perera@…", status: "Active", lastLogin: "Today 08:12", actions: ["Edit", "Reset pwd"] },
  { initials: "SK", name: "S. Kumari", role: "Worker", email: "s.kumari@…", status: "Active", lastLogin: "Today 07:45", actions: ["Edit", "Deactivate"] },
  { initials: "KB", name: "K. Banda", role: "Kitchen Staff", email: "k.banda@…", status: "Active", lastLogin: "Today 09:00", actions: ["Edit", "Deactivate"] },
  { initials: "PR", name: "P. Ratna", role: "Worker", email: "p.ratna@…", status: "Inactive", lastLogin: "3 Apr", actions: ["Activate", "Edit"] },
];

export default function StaffPage() {
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Staff accounts</h1>
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

      {/* Create staff account form */}
      <section className="mb-8">
        <h2 className="font-medium text-[12px] underline text-black mb-3">Staff account management</h2>
        <div className="border border-gray-200 rounded-lg p-5">
          <h3 className="font-medium text-[11.5px] text-black mb-4">Create staff account</h3>

          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: "Full name", value: "Kamani Bandara" },
              { label: "Role", value: "Receptionist" },
              { label: "Vocation", value: "Front desk" },
            ].map((f) => (
              <div key={f.label}>
                <label className="font-normal text-[10px] text-black/60 block mb-1">{f.label}</label>
                <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                  <span className="font-normal text-[11px] text-black">{f.value}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: "Email", value: "k.bandara@foreverhotel.lk" },
              { label: "Phone", value: "077 123 4567" },
              { label: "NIC", value: "199012345678" },
            ].map((f) => (
              <div key={f.label}>
                <label className="font-normal text-[10px] text-black/60 block mb-1">{f.label}</label>
                <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                  <span className="font-normal text-[11px] text-black">{f.value}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="font-normal text-[10px] text-black/60 block mb-1">Age</label>
              <div className="w-full border border-gray-200 rounded-md px-3 py-2">
                <span className="font-normal text-[11px] text-black">29</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-md px-3 py-3 mb-5">
            <span className="font-normal text-[10px] text-black">Username and temporary password will be auto-generated and sent to the email address above.</span>
          </div>

          <div className="flex gap-3">
            <button className="font-normal text-[11px] text-black bg-gray-100 rounded-md px-4 py-2">Create account</button>
            <button className="font-normal text-[11px] text-black border border-gray-200 rounded-md px-4 py-2">Cancel</button>
          </div>
        </div>
      </section>

      {/* All staff accounts table */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-[12px] text-black">All staff accounts</h2>
          <button className="font-medium text-[10px] text-black underline">+ Add new</button>
        </div>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {["Name","Role","Email","Status","Last login","Actions"].map((h) => (
                  <th key={h} className="font-medium text-[10.5px] text-black px-3 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s, i, arr) => (
                <tr key={s.name} className={i < arr.length - 1 ? "border-b border-gray-100" : ""}>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <span className="font-medium text-[9px] text-black">{s.initials}</span>
                      </div>
                      <span className="font-normal text-[10.5px] text-black">{s.name}</span>
                    </div>
                  </td>
                  <td className="text-[10.5px] text-black px-3 py-3">{s.role}</td>
                  <td className="text-[10.5px] text-black px-3 py-3">{s.email}</td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-[9.5px] text-black bg-gray-100 rounded-full px-2 py-1">{s.status}</span>
                  </td>
                  <td className="text-[10.5px] text-black px-3 py-3">{s.lastLogin}</td>
                  <td className="px-3 py-3">
                    {s.actions.map((a, ai) => (
                      <React.Fragment key={a}>
                        {ai > 0 && <span className="text-[10px] text-black mx-1">·</span>}
                        <button className="font-normal text-[10px] text-black underline">{a}</button>
                      </React.Fragment>
                    ))}
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
