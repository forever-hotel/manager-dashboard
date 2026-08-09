"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login" || pathname === "/";

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex w-full min-h-screen bg-white text-black">
      <Sidebar />
      <div className="flex-1 min-w-0 pl-[220px]">{children}</div>
    </div>
  );
}
