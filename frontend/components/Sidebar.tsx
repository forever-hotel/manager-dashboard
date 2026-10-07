"use client";

import React, { useRef, useState } from "react";
import { replaceLocation } from "@/lib/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";

const groups: { label: string; items: { name: string; href: string; badge?: number }[] }[] = [
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
      { name: "Complaints", href: "/complaints" },
    ],
  },
  {
    label: "Management",
    items: [
      { name: "Promotions", href: "/promotions" },
      { name: "Staff accounts", href: "/staff" },
      { name: "Worker performance", href: "/worker-performance" },
      { name: "Notifications", href: "/notifications" },
      { name: "Tasks", href: "/tasks" },
      { name: "Reports", href: "/reports" },
      { name: "Settings", href: "/settings" },
    ],
  },
];

export function Sidebar({ open, close, username }: { open: boolean; close: () => void; username: string }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  async function logout() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      replaceLocation('/login');
    } catch {
      locked.current = false;
      setPending(false);
      setError('Sign out could not finish. Please retry.');
    }
  }

  return (
    <aside id="dashboard-navigation" className={`${open ? "flex" : "hidden"} md:flex md:w-[220px] shrink-0 border-r border-gray-200 flex-col justify-between md:h-screen md:fixed left-0 top-0 bg-white overflow-y-auto`}>
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
        <nav aria-label="Dashboard" className="px-3 pt-5 space-y-6">
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
                      prefetch={false}
                      onClick={close}
                      aria-current={isActive ? "page" : undefined}
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
      <div>
      <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100">
        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
          <span className="font-medium text-[10px] text-black">{username.slice(0, 2).toUpperCase()}</span>
        </div>
        <div className="leading-tight">
          <div className="text-[10.5px] text-black">{username}</div>
          <div className="text-[9.5px] text-black/60">Manager</div>
        </div>
      </div>
        <div className="px-5 pb-4">
          <button type="button" onClick={() => void logout()} disabled={pending}
            className="w-full border border-gray-200 rounded-md py-2 text-[11px] text-black hover:bg-gray-50 disabled:opacity-50">
            {pending ? 'Signing out...' : 'Logout'}
          </button>
          {error && <p role="alert" className="text-[10px] text-red-600 mt-2">{error}</p>}
        </div>
      </div>
    </aside>
  );
}
