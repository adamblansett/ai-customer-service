'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, clearAuthToken } from '@/lib/api-client';
import { Building2, LogOut, User, Plus, Radio } from 'lucide-react';

interface TenantItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export function Header() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState('Acme Heating & Cooling');
  const [activeTenantId, setActiveTenantId] = useState('tenant_acme_hvac_001');
  const [tenants, setTenants] = useState<TenantItem[]>([
    {
      id: 'tenant_acme_hvac_001',
      name: 'Acme Heating & Cooling',
      slug: 'acme-hvac',
      role: 'owner',
    },
  ]);
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [isCreatingTenant, setIsCreatingTenant] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');

  useEffect(() => {
    const storedId = localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001';
    const storedTenant = localStorage.getItem('active_tenant_name') || 'Acme Heating & Cooling';
    setActiveTenantId(storedId);
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

    apiFetch<{ tenants: TenantItem[] }>('/tenants')
      .then((res) => {
        if (res?.tenants?.length) {
          setTenants(res.tenants);
        }
      })
      .catch(() => {
        // Keep local fallback
      });
  }, []);

  const handleSelectTenant = (id: string) => {
    const chosen = tenants.find((t) => t.id === id);
    if (!chosen) return;
    setActiveTenantId(chosen.id);
    setTenantName(chosen.name);
    localStorage.setItem('active_tenant_id', chosen.id);
    localStorage.setItem('active_tenant_name', chosen.name);
    window.location.reload();
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenantName.trim()) return;
    const name = newTenantName.trim();
    setNewTenantName('');
    setIsCreatingTenant(false);

    try {
      const res = await apiFetch<{ tenant: TenantItem }>('/tenants', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (res?.tenant) {
        const nextList = [...tenants, { ...res.tenant, role: 'owner' }];
        setTenants(nextList);
        localStorage.setItem('active_tenant_id', res.tenant.id);
        localStorage.setItem('active_tenant_name', res.tenant.name);
        setActiveTenantId(res.tenant.id);
        setTenantName(res.tenant.name);
      }
    } catch {
      const fallback: TenantItem = {
        id: `tenant_${Date.now()}`,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        role: 'owner',
      };
      setTenants((prev) => [...prev, fallback]);
      setActiveTenantId(fallback.id);
      setTenantName(fallback.name);
    }
  };

  const handleLogout = () => {
    clearAuthToken();
    localStorage.removeItem('current_user');
    localStorage.removeItem('active_tenant_id');
    localStorage.removeItem('active_tenant_name');
    router.push('/login');
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2.5">
        <Building2 className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tenant:</span>
        <select
          value={activeTenantId}
          onChange={(e) => handleSelectTenant(e.target.value)}
          aria-label="Active business tenant"
          className="text-xs font-semibold text-slate-900 bg-slate-100 px-2.5 py-1.5 rounded-md border border-slate-200 cursor-pointer"
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {!isCreatingTenant ? (
          <button
            type="button"
            onClick={() => setIsCreatingTenant(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Tenant</span>
          </button>
        ) : (
          <form onSubmit={handleCreateTenant} className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Business name..."
              value={newTenantName}
              onChange={(e) => setNewTenantName(e.target.value)}
              className="px-2.5 py-1 text-xs border border-slate-300 rounded-md"
            />
            <button
              type="submit"
              className="px-2.5 py-1 text-xs font-semibold bg-sky-600 text-white rounded-md"
            >
              Create
            </button>
          </form>
        )}

        <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full ml-2">
          <Radio className="w-3 h-3 text-emerald-600 animate-pulse" />
          <span>SSE Live Stream</span>
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-600">
            <User className="w-4 h-4" />
          </div>
          <div>
            <span className="font-medium text-slate-800 text-xs block">
              {userName || 'Authenticated Agent'}
            </span>
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
