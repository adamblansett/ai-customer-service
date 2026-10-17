'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import {
  PhoneCall,
  MessagesSquare,
  UserCheck,
  CalendarClock,
  BookOpen,
  ArrowRight,
  PhoneForwarded,
  Settings,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface OverviewMetrics {
  totalCalls: number;
  activeConversations: number;
  waitingForAgent: number;
  pendingCallbacks: number;
  indexedDocuments: number;
}

export default function OverviewPage() {
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMetrics = async () => {
    setIsLoading(true);
    setError('');
    const tenantId = localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001';

    try {
      const data = await apiFetch<OverviewMetrics>(`/tenants/${tenantId}/overview`);
      setMetrics(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load live overview metrics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Overview</h1>
          <p className="text-sm text-slate-500">Live contact center activity and operational statistics</p>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Inbound Calls</span>
            <PhoneCall className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-3xl font-bold text-slate-900">
            {isLoading ? '...' : metrics?.totalCalls ?? 0}
          </div>
          <p className="text-xs text-slate-500 mt-1">Total recorded voice calls</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Chats/Calls</span>
            <MessagesSquare className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-bold text-emerald-700">
            {isLoading ? '...' : metrics?.activeConversations ?? 0}
          </div>
          <p className="text-xs text-slate-500 mt-1">Live in-flight conversations</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Waiting for Agent</span>
            <UserCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-3xl font-bold text-amber-700">
            {isLoading ? '...' : metrics?.waitingForAgent ?? 0}
          </div>
          <p className="text-xs text-slate-500 mt-1">Escalated to human queue</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Callbacks</span>
            <CalendarClock className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-3xl font-bold text-indigo-700">
            {isLoading ? '...' : metrics?.pendingCallbacks ?? 0}
          </div>
          <p className="text-xs text-slate-500 mt-1">After-hours & failed transfers</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Knowledge Base</span>
            <BookOpen className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-3xl font-bold text-purple-700">
            {isLoading ? '...' : metrics?.indexedDocuments ?? 0}
          </div>
          <p className="text-xs text-slate-500 mt-1">Indexed approved docs</p>
        </div>
      </div>

      {/* Quick Launchpad */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center mb-4">
              <PhoneForwarded className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Inbound Voice Simulator</h2>
            <p className="text-sm text-slate-500 mb-4">
              Test end-to-end phone calls locally without paying for telephony charges or real carrier setup.
            </p>
          </div>
          <Link
            href="/simulator"
            className="inline-flex items-center gap-2 text-sm font-medium text-sky-600 hover:text-sky-700"
          >
            <span>Launch Call Simulator</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4">
              <MessagesSquare className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Live Agent Console</h2>
            <p className="text-sm text-slate-500 mb-4">
              Monitor customer calls and website chats in real time, take over escalated sessions, and respond directly.
            </p>
          </div>
          <Link
            href="/conversations"
            className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
          >
            <span>Open Agent Console</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Business Knowledge Base</h2>
            <p className="text-sm text-slate-500 mb-4">
              Upload approved FAQs, service rates, and policies with semantic chunking and interactive relevance testing.
            </p>
          </div>
          <Link
            href="/knowledge"
            className="inline-flex items-center gap-2 text-sm font-medium text-purple-600 hover:text-purple-700"
          >
            <span>Manage Knowledge</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
