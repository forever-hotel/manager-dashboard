"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login" || pathname === "/";

  if (isLoginPage) {
    return <div className="app-container">{children}</div>;
  }

  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content pl-64">{children}</div>
    </div>
  );
}
