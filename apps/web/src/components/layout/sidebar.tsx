'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessagesSquare,
  BookOpen,
  PhoneCall,
  PhoneForwarded,
  Settings,
  KeyRound,
  MessageCircleCode,
  ShieldCheck,
  Users,
  BarChart3,
  CreditCard,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/conversations', label: 'Live Conversations', icon: MessagesSquare },
  { href: '/queues', label: 'Queues & ACD', icon: Users },
  { href: '/analytics', label: 'Analytics & CSAT', icon: BarChart3 },
  { href: '/knowledge', label: 'Knowledge Base', icon: BookOpen },
  { href: '/calls', label: 'Calls & Callbacks', icon: PhoneCall },
  { href: '/simulator', label: 'Voice Simulator', icon: PhoneForwarded },
  { href: '/billing', label: 'Billing & Usage', icon: CreditCard },
  { href: '/settings', label: 'Business Settings', icon: Settings },
  { href: '/integrations', label: 'BYOK Integrations', icon: KeyRound },
  { href: '/chat-widget', label: 'Website Chat Demo', icon: MessageCircleCode },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 flex-shrink-0">
      <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-800">
        <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <span className="font-bold text-white text-sm block">Customer Service</span>
          <span className="text-xs text-sky-400 block font-mono">v0.1.0 Open-Source</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
        <p>Tenant-Isolated Context</p>
        <p className="mt-0.5">AES-256-GCM BYOK Security</p>
      </div>
    </aside>
  );
}
