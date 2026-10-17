'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  PhoneCall,
  CalendarClock,
  CheckCircle2,
  Clock,
  RefreshCw,
  PhoneForwarded,
} from 'lucide-react';

interface CallSession {
  id: string;
  callSid: string;
  provider: string;
  fromNumber: string;
  toNumber: string;
  direction: string;
  callStatus: string;
  durationSeconds: number;
  transferDestination?: string;
  transferStatus?: string;
  createdAt: string;
}

interface CallbackRequest {
  id: string;
  phoneNumber: string;
  reason: string;
  status: string;
  requestedAt: string;
  notes?: string;
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallSession[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const tenantId = typeof window !== 'undefined'
    ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
    : 'tenant_acme_hvac_001';

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const callsRes = await apiFetch<{ calls: CallSession[] }>(`/tenants/${tenantId}/calls`);
      const callbacksRes = await apiFetch<{ callbacks: CallbackRequest[] }>(`/tenants/${tenantId}/callbacks`);
      setCalls(callsRes.calls || []);
      setCallbacks(callbacksRes.callbacks || []);
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCompleteCallback = async (callbackId: string) => {
    try {
      await apiFetch(`/tenants/${tenantId}/callbacks/${callbackId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Handled via contact center console' }),
      });
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to complete callback');
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Calls & Callback Requests</h1>
          <p className="text-sm text-slate-500">Telephony call logs, transfer records, and after-hours callbacks</p>
        </div>

        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Pending Callbacks Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">Pending Callback Requests ({callbacks.length})</h2>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {callbacks.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-400">No pending callback requests.</p>
          ) : (
            callbacks.map((cb) => (
              <div key={cb.id} className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 font-mono text-sm">{cb.phoneNumber}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        cb.status === 'completed'
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {cb.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700">{cb.reason}</p>
                  <p className="text-xs text-slate-400">
                    Requested: {new Date(cb.requestedAt).toLocaleString()}
                  </p>
                </div>

                {cb.status !== 'completed' && (
                  <button
                    onClick={() => handleCompleteCallback(cb.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-xs shadow-sm transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Mark Handled</span>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recent Calls Log */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PhoneCall className="w-5 h-5 text-sky-600" />
            <h2 className="text-sm font-bold text-slate-900">Recent Voice Call Sessions ({calls.length})</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-6">Call SID</th>
                <th className="py-3 px-6">Caller Phone</th>
                <th className="py-3 px-6">Status</th>
                <th className="py-3 px-6">Duration</th>
                <th className="py-3 px-6">Transfer Dest.</th>
                <th className="py-3 px-6">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                    No voice calls recorded yet.
                  </td>
                </tr>
              ) : (
                calls.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-6 font-mono text-xs text-slate-800">{c.callSid}</td>
                    <td className="py-3 px-6 font-mono text-xs">{c.fromNumber}</td>
                    <td className="py-3 px-6">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          c.callStatus === 'completed'
                            ? 'bg-slate-100 text-slate-700'
                            : c.callStatus === 'in-progress'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {c.callStatus}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-xs">{c.durationSeconds}s</td>
                    <td className="py-3 px-6 text-xs font-mono">{c.transferDestination || '—'}</td>
                    <td className="py-3 px-6 text-xs text-slate-400">
                      {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
