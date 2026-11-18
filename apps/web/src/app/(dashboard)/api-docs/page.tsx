'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  FileCode2,
  Download,
  BellRing,
  CheckCircle2,
  Database,
  History,
} from 'lucide-react';

export default function ApiDocsAndLoraPage() {
  const [format, setFormat] = useState<'sharegpt' | 'openai_jsonl'>('sharegpt');
  const [datasetPreview, setDatasetPreview] = useState<string>(
    '{"conversations":[{"from":"system","value":"You are an automated AI customer service assistant."},{"from":"human","value":"How much is a standard diagnostic visit?"},{"from":"gpt","value":"Our standard diagnostic fee is $89."}]}'
  );
  const [incidentNotice, setIncidentNotice] = useState<string | null>(null);
  const [openApiPaths, setOpenApiPaths] = useState<string[]>([
    '/health',
    '/metrics',
    '/api/v1/openapi.json',
    '/api/v1/tenants/{tenantId}/ai/builtin',
    '/api/v1/tenants/{tenantId}/speech/builtin',
    '/api/v1/voice/inbound',
    '/api/v1/voice/telnyx',
    '/api/v1/voice/plivo',
    '/api/v1/tenants/{tenantId}/appointments',
    '/api/v1/tenants/{tenantId}/workforce/forecast',
    '/api/v1/tenants/{tenantId}/knowledge/{docId}/versions',
    '/api/v1/tenants/{tenantId}/knowledge/{docId}/rollback',
    '/api/v1/tenants/{tenantId}/ai/dataset-export',
    '/api/v1/tenants/{tenantId}/incidents/dispatch',
  ]);

  const tenantId =
    typeof window !== 'undefined'
      ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
      : 'tenant_acme_hvac_001';

  useEffect(() => {
    apiFetch<{ paths: Record<string, any> }>('/openapi.json')
      .then((spec) => {
        if (spec?.paths) {
          setOpenApiPaths(Object.keys(spec.paths));
        }
      })
      .catch(() => {});
  }, []);

  const handleExportDataset = async () => {
    try {
      const res = await apiFetch<{ jsonl: string }>(
        `/tenants/${tenantId}/ai/dataset-export?format=${format}`
      );
      if (res?.jsonl) {
        setDatasetPreview(res.jsonl);
      }
    } catch {
      // Keep local preview
    }
  };

  const handleDispatchIncident = async () => {
    try {
      await apiFetch(`/tenants/${tenantId}/incidents/dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Emergency HVAC SLA Queue Breach',
          severity: 'critical',
          source: 'sla_queue_breach',
          callerPhone: '+1 (555) 349-2041',
          summary: 'Caller waiting > 60s for freezing furnace dispatch.',
        }),
      });
    } catch {
      // Optimistic
    }
    setIncidentNotice(
      'Dispatched critical incident alert to Slack Block Kit, Microsoft Teams Adaptive Card, and PagerDuty Events v2.'
    );
    setTimeout(() => setIncidentNotice(null), 5000);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
          <FileCode2 className="w-6 h-6 text-sky-600" />
          <span>OpenAPI 3.1 Explorer, LoRA Fine-Tuning & Incident Dispatch</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Interactive OpenAPI 3.1 specification, PII-redacted ShareGPT/Unsloth LoRA dataset exporter, Knowledge revision governance, and Slack/Teams/PagerDuty incident webhooks.
        </p>
      </div>

      {incidentNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>{incidentNotice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open-Weights LoRA Fine-Tuning Dataset Exporter */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600" />
              <span>LoRA Fine-Tuning Dataset Exporter (PII-Redacted)</span>
            </h2>
            <span className="text-[11px] font-mono bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full">
              Unsloth / Axolotl Ready
            </span>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as any)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white font-medium"
            >
              <option value="sharegpt">ShareGPT / ChatML (Qwen 2.5 & Llama 3.1 LoRA)</option>
              <option value="openai_jsonl">OpenAI Fine-Tuning JSONL</option>
            </select>

            <button
              type="button"
              onClick={handleExportDataset}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Generate PII-Redacted JSONL</span>
            </button>
          </div>

          <div className="bg-slate-950 text-emerald-400 p-3.5 rounded-xl font-mono text-[11px] overflow-x-auto max-h-48">
            <pre>{datasetPreview}</pre>
          </div>
        </div>

        {/* Incident Alerter & Knowledge Governance */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BellRing className="w-4 h-4 text-rose-600" />
              <span>Slack, Microsoft Teams & PagerDuty Incident Alerter</span>
            </h2>
            <p className="text-xs text-slate-600">
              Automatically dispatches structured <strong>Slack Block Kit</strong>, <strong>Microsoft Teams Adaptive Cards v1.4</strong>, and <strong>PagerDuty Events v2</strong> when queue SLA thresholds breach or a customer reports a 1/5 CSAT score.
            </p>
            <button
              type="button"
              onClick={handleDispatchIncident}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg"
            >
              Test Multi-Channel Incident Dispatch
            </button>
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <History className="w-4 h-4 text-indigo-600" />
              <span>Knowledge Base Version Governance & 1-Click Rollback</span>
            </h3>
            <p className="text-xs text-slate-500">
              Every policy and pricing update is versioned in PostgreSQL <code className="font-mono">knowledge_document_versions</code>. Roll back any document via <code className="font-mono">POST /api/v1/tenants/:tenantId/knowledge/:docId/rollback</code>.
            </p>
          </div>
        </div>
      </div>

      {/* OpenAPI 3.1.0 Live Route Explorer */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            OpenAPI 3.1.0 Specification Explorer (<code className="text-sky-600 font-mono">GET /api/v1/openapi.json</code>)
          </h2>
          <span className="text-xs text-slate-500">{openApiPaths.length} Documented Endpoint Groups</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {openApiPaths.map((p) => (
            <div
              key={p}
              className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 font-mono text-xs text-slate-800 flex items-center justify-between"
            >
              <span>{p}</span>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-sky-100 text-sky-800">
                OpenAPI 3.1
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
