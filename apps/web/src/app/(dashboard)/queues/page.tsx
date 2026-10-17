'use client';

import React, { useState } from 'react';
import {
  Users,
  Clock,
  PhoneCall,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Filter,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

interface QueuedCaller {
  id: string;
  callSid: string;
  phoneNumber: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  requiredSkills: string[];
  enqueuedAt: string;
  waitSeconds: number;
}

interface AgentPresence {
  id: string;
  name: string;
  status: 'available' | 'on_call' | 'away' | 'wrap_up';
  skills: string[];
  callsHandled: number;
  idleMinutes: number;
}

const INITIAL_QUEUE: QueuedCaller[] = [
  {
    id: 'q-101',
    callSid: 'CA_LIVE_49201',
    phoneNumber: '+1 (555) 349-2041',
    priority: 'urgent',
    requiredSkills: ['emergency', 'hvac-tech'],
    enqueuedAt: '2 min ago',
    waitSeconds: 135,
  },
  {
    id: 'q-102',
    callSid: 'CA_LIVE_58194',
    phoneNumber: '+1 (555) 892-1140',
    priority: 'high',
    requiredSkills: ['billing'],
    enqueuedAt: '4 min ago',
    waitSeconds: 240,
  },
  {
    id: 'q-103',
    callSid: 'CA_LIVE_90241',
    phoneNumber: '+1 (555) 231-9872',
    priority: 'normal',
    requiredSkills: ['general-inquiry'],
    enqueuedAt: '1 min ago',
    waitSeconds: 60,
  },
];

const INITIAL_AGENTS: AgentPresence[] = [
  {
    id: 'ag-1',
    name: 'Sarah Agent',
    status: 'available',
    skills: ['emergency', 'hvac-tech', 'billing'],
    callsHandled: 14,
    idleMinutes: 6,
  },
  {
    id: 'ag-2',
    name: 'Marcus Vance',
    status: 'on_call',
    skills: ['hvac-tech', 'commercial'],
    callsHandled: 19,
    idleMinutes: 0,
  },
  {
    id: 'ag-3',
    name: 'Elena Rostova',
    status: 'available',
    skills: ['billing', 'spanish', 'general-inquiry'],
    callsHandled: 12,
    idleMinutes: 14,
  },
  {
    id: 'ag-4',
    name: 'David Chen',
    status: 'away',
    skills: ['commercial', 'hvac-tech'],
    callsHandled: 8,
    idleMinutes: 25,
  },
];

export default function QueuesPage() {
  const [queue, setQueue] = useState<QueuedCaller[]>(INITIAL_QUEUE);
  const [agents, setAgents] = useState<AgentPresence[]>(INITIAL_AGENTS);
  const [selectedSkillFilter, setSelectedSkillFilter] = useState<string>('all');
  const [myStatus, setMyStatus] = useState<'available' | 'on_call' | 'away' | 'wrap_up'>('available');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const handleAssignToMe = (callId: string) => {
    const caller = queue.find((q) => q.id === callId);
    if (!caller) return;
    setQueue((prev) => prev.filter((q) => q.id !== callId));
    setMyStatus('on_call');
    setActionNotice(`Call ${caller.phoneNumber} answered and bridged to your WebRTC console.`);
    setTimeout(() => setActionNotice(null), 5000);
  };

  const handleUpdateStatus = (status: 'available' | 'on_call' | 'away' | 'wrap_up') => {
    setMyStatus(status);
    setAgents((prev) =>
      prev.map((ag) => (ag.id === 'ag-1' ? { ...ag, status } : ag))
    );
  };

  const filteredQueue = queue.filter((c) => {
    if (selectedSkillFilter === 'all') return true;
    return c.requiredSkills.includes(selectedSkillFilter);
  });

  const allSkills = Array.from(new Set(queue.flatMap((q) => q.requiredSkills)));

  return (
    <div className="space-y-6">
      {/* Header and Agent Self-Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Contact Center Queues & ACD Wallboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time automatic call distribution, priority queues, and live agent presence.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            My Presence:
          </span>
          <select
            value={myStatus}
            onChange={(e) => handleUpdateStatus(e.target.value as any)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border outline-none cursor-pointer transition-colors ${
              myStatus === 'available'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : myStatus === 'on_call'
                ? 'bg-amber-50 text-amber-700 border-amber-300'
                : 'bg-slate-100 text-slate-700 border-slate-300'
            }`}
          >
            <option value="available">🟢 Available (Ready)</option>
            <option value="on_call">🟡 On Call</option>
            <option value="wrap_up">🔵 Wrap Up</option>
            <option value="away">⚪ Away / Break</option>
          </select>
        </div>
      </div>

      {actionNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Wallboard Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Queued Callers
            </span>
            <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
              <PhoneCall className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">{queue.length}</span>
            <span className="text-xs text-slate-500">waiting</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Longest Wait Time
            </span>
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">
              {queue.length > 0
                ? `${Math.floor(Math.max(...queue.map((q) => q.waitSeconds)) / 60)}m ${
                    Math.max(...queue.map((q) => q.waitSeconds)) % 60
                  }s`
                : '0m 0s'}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Agents Ready
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">
              {agents.filter((a) => a.status === 'available').length}
            </span>
            <span className="text-xs text-slate-500">of {agents.length} online</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              ACD Dispatch Policy
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-sm font-semibold text-slate-900 block">Longest Idle First</span>
            <span className="text-xs text-slate-500">Skills-Based Fallback</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Waiting Calls Column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <PhoneCall className="w-5 h-5 text-sky-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  Active Waiting Calls ({filteredQueue.length})
                </h2>
              </div>

              {/* Skills filter */}
              <div className="flex items-center gap-2 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-500">Filter Skill:</span>
                <select
                  value={selectedSkillFilter}
                  onChange={(e) => setSelectedSkillFilter(e.target.value)}
                  className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 outline-none"
                >
                  <option value="all">All Skills</option>
                  {allSkills.map((sk) => (
                    <option key={sk} value={sk}>
                      {sk}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {filteredQueue.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">
                  No callers currently waiting in this queue.
                </div>
              ) : (
                filteredQueue.map((caller) => (
                  <div
                    key={caller.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-sm font-mono">
                          {caller.phoneNumber}
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            caller.priority === 'urgent'
                              ? 'bg-rose-100 text-rose-800'
                              : caller.priority === 'high'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {caller.priority}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Wait: {caller.waitSeconds}s</span>
                        <span>•</span>
                        <span>Call SID: {caller.callSid}</span>
                      </div>

                      <div className="flex flex-wrap gap-1 pt-1">
                        {caller.requiredSkills.map((sk) => (
                          <span
                            key={sk}
                            className="text-[11px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-md font-mono"
                          >
                            {sk}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => handleAssignToMe(caller.id)}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
                    >
                      <span>Take Call</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Live Agent Roster */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3 mb-3">
              <Users className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-semibold text-slate-900">Staff Roster</h2>
            </div>

            <div className="space-y-3">
              {agents.map((ag) => (
                <div
                  key={ag.id}
                  className="p-3 rounded-lg border border-slate-100 bg-slate-50/60 flex items-start justify-between gap-2"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 text-sm">{ag.name}</span>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          ag.status === 'available'
                            ? 'bg-emerald-500'
                            : ag.status === 'on_call'
                            ? 'bg-amber-500'
                            : 'bg-slate-400'
                        }`}
                      />
                    </div>
                    <div className="text-xs text-slate-500">
                      Calls Today: <strong className="text-slate-700">{ag.callsHandled}</strong> • Idle:{' '}
                      <strong className="text-slate-700">{ag.idleMinutes}m</strong>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {ag.skills.map((s) => (
                        <span
                          key={s}
                          className="text-[10px] bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      ag.status === 'available'
                        ? 'bg-emerald-100 text-emerald-800'
                        : ag.status === 'on_call'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {ag.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
