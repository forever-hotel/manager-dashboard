import React from "react";

const topBarSvg = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

function TopBar({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="font-medium text-[15px] text-black">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
          <button className="font-normal text-[10.5px] text-black px-3 py-1 rounded">Day</button>
          <button className="font-medium text-[10.5px] text-black px-3 py-1 rounded bg-white shadow-sm">Week</button>
          <button className="font-normal text-[10.5px] text-black px-3 py-1 rounded">Month</button>
        </div>
        {topBarSvg}
      </div>
    </div>
  );
}

const rooms: { id: string; status: "occ" | "clean" | "maint" | "free" }[][] = [
  [
    { id: "101", status: "occ" },
    { id: "102", status: "occ" },
    { id: "103", status: "clean" },
    { id: "104", status: "free" },
    { id: "105", status: "occ" },
    { id: "106", status: "maint" },
    { id: "107", status: "free" },
    { id: "108", status: "occ" },
  ],
  [
    { id: "201", status: "free" },
    { id: "202", status: "occ" },
    { id: "203", status: "occ" },
    { id: "204", status: "clean" },
    { id: "205", status: "free" },
    { id: "206", status: "occ" },
    { id: "207", status: "maint" },
    { id: "208", status: "clean" },
  ],
  [
    { id: "301", status: "occ" },
    { id: "302", status: "free" },
    { id: "303", status: "occ" },
    { id: "304", status: "free" },
    { id: "305", status: "clean" },
    { id: "306", status: "occ" },
    { id: "307", status: "occ" },
    { id: "308", status: "free" },
  ],
];

const statusConfig = {
  occ:   { bg: "#e6f1fb", text: "#0c447c", label: "Occ" },
  free:  { bg: "#eaf3de", text: "#27500a", label: "Free" },
  clean: { bg: "#faeeda", text: "#633806", label: "Clean" },
  maint: { bg: "#fcebeb", text: "#791f1f", label: "Maint" },
};

export default function RoomsPage() {
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      <TopBar title="Room status" />

      {/* Summary cards */}
      <section className="mb-6">
        <h2 className="font-medium text-[12px] underline text-black mb-3">Real-time room status board</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Vacant</div>
            <div className="font-medium text-[22px]" style={{ color: "#27500a" }}>8</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Occupied</div>
            <div className="font-medium text-[22px]" style={{ color: "#0c447c" }}>14</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Requires cleaning</div>
            <div className="font-medium text-[22px]" style={{ color: "#633806" }}>4</div>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="font-normal text-[10px] text-black/60 mb-2">Maintenance</div>
            <div className="font-medium text-[22px]" style={{ color: "#791f1f" }}>2</div>
          </div>
        </div>
      </section>

      {/* Floor plan */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-[13px] text-black">Floor plan — all rooms</h2>
          <div className="flex items-center gap-4">
            {(["Vacant","Occupied","Cleaning","Maintenance"] as const).map((label, i) => {
              const colors = ["#eaf3de","#e6f1fb","#faeeda","#fcebeb"];
              return (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[i] }} />
                  <span className="font-normal text-[9.5px] text-black">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg p-5 space-y-5">
          {rooms.map((floor, fi) => (
            <div key={fi}>
              <div className="font-normal text-[10.5px] text-black mb-2">Floor {fi + 1}</div>
              <div className="grid grid-cols-8 gap-3">
                {floor.map((room) => {
                  const cfg = statusConfig[room.status];
                  return (
                    <div
                      key={room.id}
                      className="h-10 rounded flex items-center justify-center text-center"
                      style={{ backgroundColor: cfg.bg }}
                    >
                      <span
                        className="font-medium text-[9px] leading-tight"
                        style={{ color: cfg.text }}
                      >
                        {room.id}
                        <br />
                        {cfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
