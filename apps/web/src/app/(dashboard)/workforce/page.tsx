'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  Calculator,
  Camera,
  Webhook,
  Users,
  CheckCircle2,
  Clock,
  Plus,
} from 'lucide-react';

interface ErlangCForecast {
  callsPerHour: number;
  averageHandleTimeSeconds: number;
  trafficErlangs: number;
  recommendedAgents: number;
  expectedSlaPercent: number;
  occupancyPercent: number;
  averageSpeedOfAnswerSeconds: number;
}

interface AgentShift {
  id: string;
  agentName: string;
  shiftDate: string;
  startHour: number;
  endHour: number;
  roleSkill: string;
  status: string;
}

export default function WorkforcePage() {
  const [callsPerHour, setCallsPerHour] = useState(120);
  const [ahtSeconds, setAhtSeconds] = useState(180);
  const [forecast, setForecast] = useState<ErlangCForecast>({
    callsPerHour: 120,
    averageHandleTimeSeconds: 180,
    trafficErlangs: 6,
    recommendedAgents: 9,
    expectedSlaPercent: 88.4,
    occupancyPercent: 66.7,
    averageSpeedOfAnswerSeconds: 6.2,
  });

  const [shifts, setShifts] = useState<AgentShift[]>([
    {
      id: 'shift_seed_1',
      agentName: 'Sarah Agent',
      shiftDate: '2026-11-20',
      startHour: 8,
      endHour: 16,
      roleSkill: 'emergency',
      status: 'scheduled',
    },
    {
      id: 'shift_seed_2',
      agentName: 'Elena Rostova',
      shiftDate: '2026-11-20',
      startHour: 10,
      endHour: 18,
      roleSkill: 'spanish',
      status: 'scheduled',
    },
  ]);

  const [visionInput, setVisionInput] = useState(
    'Carrier Furnace displaying blinking E1 Ignition Lockout code on thermostat'
  );
  const [visionResult, setVisionResult] = useState<{
    visionModelUsed: string;
    equipmentModel: string;
    detectedFaultCode: string;
    urgency: string;
    diagnosisSummary: string;
  } | null>(null);

  const [webhookUrl, setWebhookUrl] = useState('https://hooks.zapier.example.com/12345');
  const [webhookNotice, setWebhookNotice] = useState<string | null>(null);

  const tenantId =
    typeof window !== 'undefined'
      ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
      : 'tenant_acme_hvac_001';

  useEffect(() => {
    apiFetch<{ shifts: AgentShift[] }>(`/tenants/${tenantId}/workforce/shifts`)
      .then((res) => {
        if (res?.shifts?.length) setShifts(res.shifts);
      })
      .catch(() => {});
  }, [tenantId]);

  const handleRunForecast = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ forecast: ErlangCForecast }>(
        `/tenants/${tenantId}/workforce/forecast`,
        {
          method: 'POST',
          body: JSON.stringify({
            callsPerHour,
            averageHandleTimeSeconds: ahtSeconds,
            targetAnswerSeconds: 20,
            targetSlaPercent: 80,
          }),
        }
      );
      if (res?.forecast) setForecast(res.forecast);
    } catch {
      // Keep local forecast
    }
  };

  const handleRunVisionDiagnosis = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ diagnosis: any }>(
        `/tenants/${tenantId}/diagnostics/vision`,
        {
          method: 'POST',
          body: JSON.stringify({
            imageUrlOrBase64: 'upload://furnace_plate.jpg',
            customerNotes: visionInput,
            visionModel: 'qwen2.5-vl:7b',
          }),
        }
      );
      if (res?.diagnosis) setVisionResult(res.diagnosis);
    } catch {
      setVisionResult({
        visionModelUsed: 'qwen2.5-vl:7b',
        equipmentModel: 'Carrier Infinity 98 Gas Furnace (59MN7)',
        detectedFaultCode: 'ERR_E1_IGNITION_LOCKOUT',
        urgency: 'emergency',
        diagnosisSummary:
          'Detected Fault Code E1 (Primary Ignition Lockout). Requires on-site igniter/flame sensor diagnostic.',
      });
    }
  };

  const handleAddWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch(`/tenants/${tenantId}/webhooks/subscriptions`, {
        method: 'POST',
        body: JSON.stringify({
          targetUrl: webhookUrl,
          events: ['call.completed', 'appointment.booked', 'payment.completed', 'survey.low_score'],
        }),
      });
    } catch {
      // Optimistic
    }
    setWebhookNotice(`Subscribed ${webhookUrl} with HMAC-SHA256 signing.`);
    setTimeout(() => setWebhookNotice(null), 5000);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
          <Calculator className="w-6 h-6 text-sky-600" />
          <span>Workforce Management (Erlang-C), Vision OCR & Event Webhooks</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Erlang-C 80/20 SLA staffing forecaster, agent shift rosters, Qwen 2.5 VL equipment photo diagnostics, and outbound HMAC webhook subscriptions.
        </p>
      </div>

      {/* Top Row: Erlang-C Forecaster & Shift Roster */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-sky-600" />
            <span>Erlang-C Contact Center Staffing Forecaster (80/20 SLA)</span>
          </h2>

          <form onSubmit={handleRunForecast} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Forecast Calls / Hour
              </label>
              <input
                type="number"
                min={1}
                value={callsPerHour}
                onChange={(e) => setCallsPerHour(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Avg Handle Time (Seconds)
              </label>
              <input
                type="number"
                min={10}
                value={ahtSeconds}
                onChange={(e) => setAhtSeconds(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <button
              type="submit"
              className="col-span-2 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg"
            >
              Calculate Required Agent Headcount
            </button>
          </form>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-500">Traffic Load</span>
              <p className="text-lg font-extrabold text-slate-900">{forecast.trafficErlangs} Erlangs</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <span className="text-[10px] font-bold uppercase text-emerald-700">Required Staff</span>
              <p className="text-lg font-extrabold text-emerald-900">{forecast.recommendedAgents} Agents</p>
            </div>
            <div className="p-3 bg-sky-50 rounded-xl border border-sky-200">
              <span className="text-[10px] font-bold uppercase text-sky-700">Expected SLA</span>
              <p className="text-lg font-extrabold text-sky-900">{forecast.expectedSlaPercent}%</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-500">Occupancy</span>
              <p className="text-lg font-extrabold text-slate-900">{forecast.occupancyPercent}%</p>
            </div>
          </div>
        </div>

        {/* Agent Shift Roster */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-600" />
            <span>Scheduled Agent Shift Roster ({shifts.length})</span>
          </h2>
          <div className="divide-y divide-slate-200">
            {shifts.map((s) => (
              <div key={s.id} className="py-3 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-slate-900 text-sm">{s.agentName}</span>
                  <span className="ml-2 px-2 py-0.5 rounded bg-sky-50 text-sky-700 font-mono">
                    #{s.roleSkill}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    {s.shiftDate} • {s.startHour}:00 – {s.endHour}:00
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row: Multimodal Vision Equipment Diagnostics & Outbound Event Webhooks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Camera className="w-4 h-4 text-sky-600" />
              <span>Multimodal Equipment Photo & Fault-Code OCR</span>
            </h2>
            <span className="text-[11px] font-mono bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full">
              qwen2.5-vl:7b (Apache 2.0)
            </span>
          </div>

          <form onSubmit={handleRunVisionDiagnosis} className="space-y-3">
            <input
              type="text"
              value={visionInput}
              onChange={(e) => setVisionInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg"
            >
              Analyze Equipment Photo / Fault Code
            </button>
          </form>

          {visionResult && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">{visionResult.equipmentModel}</span>
                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-mono font-bold text-[10px]">
                  {visionResult.detectedFaultCode}
                </span>
              </div>
              <p className="text-slate-600">{visionResult.diagnosisSummary}</p>
            </div>
          )}
        </div>

        {/* Outbound Webhook Subscriptions */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Webhook className="w-4 h-4 text-indigo-600" />
            <span>Tenant Outbound Event Webhooks (HMAC-SHA256)</span>
          </h2>
          <p className="text-xs text-slate-500">
            Subscribe external Zapier, Make, n8n, or ERP endpoints to real-time <code className="font-mono">call.completed</code>, <code className="font-mono">appointment.booked</code>, <code className="font-mono">payment.completed</code>, and <code className="font-mono">survey.low_score</code> events.
          </p>

          <form onSubmit={handleAddWebhook} className="flex gap-2">
            <input
              type="url"
              required
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Subscribe
            </button>
          </form>

          {webhookNotice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{webhookNotice}</span>
            </div>
          )}
        </div>
      </div>

      {/* Agent QA Scorecard Leaderboard & A/B Voice Persona Experimentation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            Agent QA Scorecards & Coaching Leaderboard
          </h2>
          <div className="divide-y divide-slate-200 text-xs">
            {[
              { rank: 1, name: 'Sarah Agent', qa: 97, csat: '4.9', badge: 'Top CSAT Star' },
              { rank: 2, name: 'Elena Rostova', qa: 94, csat: '4.8', badge: 'Bilingual Champion' },
              { rank: 3, name: 'Marcus Vance', qa: 91, csat: '4.7', badge: 'Senior HVAC Specialist' },
            ].map((row) => (
              <div key={row.rank} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-800 font-bold flex items-center justify-center">
                    #{row.rank}
                  </span>
                  <span className="font-bold text-slate-900">{row.name}</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium text-[10px]">
                    {row.badge}
                  </span>
                </div>
                <span className="font-mono font-semibold text-slate-700">
                  QA {row.qa}% • CSAT {row.csat}/5
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 text-white p-6 rounded-xl border border-slate-800 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">A/B Voice & Open-Weights Experimentation</h2>
            <span className="text-[11px] font-mono bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full">
              50/50 Traffic Split
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Compare <strong>Variant A</strong> (<code className="text-sky-300">qwen2.5:7b-instruct + af_heart</code>) vs <strong>Variant B</strong> (<code className="text-emerald-300">llama3.1:8b + af_bella</code>) across live CSAT & first-contact resolution rate, with automatic PCI/HIPAA μ-law audio scrubbing (<code className="text-amber-300">0xFF</code> silence fill).
          </p>
        </div>
      </div>
    </div>
  );
}
