'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  BarChart3, 
  BedDouble, 
  Tags, 
  Users, 
  MessageSquareWarning, 
  LogOut 
} from 'lucide-react';

const navigation = [
  { name: 'Overview', href: '/overview', icon: LayoutDashboard },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Rooms', href: '/rooms', icon: BedDouble },
  { name: 'Promotions', href: '/promotions', icon: Tags },
  { name: 'Staff Accounts', href: '/staff', icon: Users },
  { name: 'Complaints', href: '/complaints', icon: MessageSquareWarning },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-64 bg-[#1a1d24] border-r border-white/5 flex flex-col h-screen fixed left-0 top-0">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-white/5">
        <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Forever Hotel
        </span>
      </div>
      
      <nav className="flex flex-1 flex-col px-4 py-6 overflow-y-auto">
        <ul role="list" className="flex flex-1 flex-col gap-y-2">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={`
                    group flex gap-x-3 rounded-md p-3 text-sm font-semibold leading-6 transition-all duration-200
                    ${isActive 
                      ? 'bg-blue-500/10 text-blue-400' 
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }
                  `}
                >
                  <item.icon
                    className={`h-5 w-5 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-white'}`}
                    aria-hidden="true"
                  />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto pt-6">
          <Link
            href="/login"
            className="group flex gap-x-3 rounded-md p-3 text-sm font-semibold leading-6 text-slate-400 hover:text-white hover:bg-white/5 transition-all duration-200"
          >
            <LogOut className="h-5 w-5 shrink-0 text-slate-400 group-hover:text-white" />
            Logout
          </Link>
        </div>
      </nav>
    </div>
  );
}
