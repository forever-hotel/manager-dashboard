"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Overview",
    items: [
      { name: "Analytics", href: "/analytics" },
      { name: "Room status", href: "/rooms" },
    ],
  },
  {
    label: "Operations",
    items: [
      { name: "Food orders", href: "/food-orders" },
      { name: "Service requests", href: "/service-requests" },
      { name: "Complaints", href: "/complaints", badge: 3 },
    ],
  },
  {
    label: "Management",
    items: [
      { name: "Promotions", href: "/promotions" },
      { name: "Staff accounts", href: "/staff" },
      { name: "Worker performance", href: "/worker-performance" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[220px] shrink-0 border-r border-gray-200 flex flex-col justify-between min-h-screen fixed left-0 top-0 bg-white">
      <div>
        {/* Logo */}
        <div className="px-5 pt-6 pb-6 border-b border-gray-100">
          <div className="font-medium text-[13px] text-black">
            Forever Hotel
          </div>
          <div className="font-normal text-[10px] text-black/60">
            Manager Dashboard
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-3 pt-5 space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="font-medium text-[10px] underline text-black px-2 mb-2">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`flex items-center justify-between w-full h-9 rounded-md px-2 transition-colors ${
                        isActive ? "bg-gray-100" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-black" />
                        <span
                          className={`text-[11px] text-black ${
                            isActive ? "font-medium" : "font-normal"
                          }`}
                        >
                          {item.name}
                        </span>
                      </div>
                      {"badge" in item && item.badge != null && (
                        <span
                          className={`text-[10px] text-black rounded-full w-5 h-5 flex items-center justify-center ${
                            isActive
                              ? "font-medium bg-white border border-gray-200"
                              : "font-normal bg-gray-100"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* User footer */}
      <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100">
        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
          <span className="font-medium text-[10px] text-black">JD</span>
        </div>
        <div className="leading-tight">
          <div className="text-[10.5px] text-black">J. Disanayake</div>
          <div className="text-[9.5px] text-black/60">Manager</div>
        </div>
      </div>
    </aside>
  );
}
