'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearAuthToken } from '@/lib/api-client';
import { Building2, LogOut, User } from 'lucide-react';

export function Header() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState('Loading...');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');

  useEffect(() => {
    const storedTenant = localStorage.getItem('active_tenant_name') || 'Acme Heating & Cooling';
    setTenantName(storedTenant);

    const storedUser = localStorage.getItem('current_user');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUserName(parsed.name || parsed.email);
        const role = parsed.memberships?.[0]?.role || 'agent';
        setUserRole(role);
      } catch {
        // Ignore JSON error
      }
    }
  }, []);

  const handleLogout = () => {
    clearAuthToken();
    localStorage.removeItem('current_user');
    localStorage.removeItem('active_tenant_id');
    localStorage.removeItem('active_tenant_name');
    router.push('/login');
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tenant:</span>
        <span className="text-sm font-semibold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
          {tenantName}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-600">
            <User className="w-4 h-4" />
          </div>
          <div>
            <span className="font-medium text-slate-800 text-xs block">{userName || 'Authenticated Agent'}</span>
            <span className="text-[10px] text-sky-600 font-semibold uppercase tracking-wider block">
              {userRole || 'agent'}
            </span>
          </div>
        </div>

        <button
          onClick={handleLogout}
          title="Sign out"
          className="p-2 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors"
          aria-label="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
