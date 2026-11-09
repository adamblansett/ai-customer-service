'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  Lock,
  Cpu,
} from 'lucide-react';

interface IntegrationCredential {
  id: string;
  provider: string;
  status: string;
  metadata?: any;
  updatedAt: string;
}

type BuiltInPresetId =
  | 'qwen2.5:7b-instruct'
  | 'qwen2.5:3b'
  | 'llama3.1:8b'
  | 'llama3.2:3b'
  | 'mistral-small:24b';

interface BuiltInAiProfile {
  id: BuiltInPresetId;
  family?: string;
  name: string;
  license: string;
  parameterCount: string;
  quantizedSizeGb: number;
  contextWindow: number;
  recommendedHardware: string;
  description: string;
}

const BUILT_IN_PRESETS: Array<{
  id: BuiltInPresetId;
  title: string;
  badge: string;
  badgeColor: string;
  specs: string;
  description: string;
}> = [
  {
    id: 'qwen2.5:7b-instruct',
    title: 'Qwen 2.5 7B Instruct',
    badge: 'Apache 2.0 • Default',
    badgeColor: 'bg-emerald-100 text-emerald-800',
    specs: '7.6B params (4.7 GB Q4_K_M) • 128k context',
    description: 'Class-leading native tool calling & strict XML RAG adherence for customer service.',
  },
  {
    id: 'qwen2.5:3b',
    title: 'Qwen 2.5 3B Instruct',
    badge: 'Lightweight CPU',
    badgeColor: 'bg-slate-100 text-slate-700',
    specs: '3.1B params (1.9 GB Q4_K_M) • 32k context',
    description: 'Sub-250ms CPU latency for low-memory VPS & edge containers.',
  },
  {
    id: 'llama3.1:8b',
    title: 'Llama 3.1 8B Instruct',
    badge: 'Meta • Voice Cadence',
    badgeColor: 'bg-blue-100 text-blue-800',
    specs: '8.0B params (4.7 GB Q4_K_M) • 128k context',
    description: 'Optimized for natural conversational English voice synthesis & multi-turn phone dialogue.',
  },
  {
    id: 'llama3.2:3b',
    title: 'Llama 3.2 3B Instruct',
    badge: 'Meta • Fast Voice CPU',
    badgeColor: 'bg-indigo-100 text-indigo-800',
    specs: '3.2B params (2.0 GB Q4_K_M) • 128k context',
    description: 'Compact 128k-context Meta model delivering natural English phrasing on CPU hosts.',
  },
  {
    id: 'mistral-small:24b',
    title: 'Mistral Small 24B Instruct',
    badge: 'Apache 2.0 • Max GPU Quality',
    badgeColor: 'bg-amber-100 text-amber-800',
    specs: '24B params (14.0 GB Q4_K_M) • 32k context',
    description: 'High-reasoning enterprise GPU model rivaling GPT-4o-mini for complex multi-department triage.',
  },
];

export default function IntegrationsPage() {
  const [credentials, setCredentials] = useState<IntegrationCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [accountSidInput, setAccountSidInput] = useState('');
  const [authTokenInput, setAuthTokenInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [builtInProfileId, setBuiltInProfileId] = useState<BuiltInPresetId>('qwen2.5:7b-instruct');
  const [activeAiMode, setActiveAiMode] = useState<'byok' | 'builtin_open_weights'>('builtin_open_weights');

  const tenantId = typeof window !== 'undefined'
    ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
    : 'tenant_acme_hvac_001';

  const fetchCredentials = async () => {
    setIsLoading(true);
    try {
      const [credData, builtInData] = await Promise.all([
        apiFetch<{ credentials: IntegrationCredential[] }>(`/tenants/${tenantId}/credentials`),
        apiFetch<{
          activeMode: 'byok' | 'builtin_open_weights';
          selectedBuiltInProfile: BuiltInAiProfile;
        }>(`/tenants/${tenantId}/ai/builtin`).catch(() => null),
      ]);
      setCredentials(credData.credentials || []);
      if (builtInData) {
        setActiveAiMode(builtInData.activeMode);
        setBuiltInProfileId(builtInData.selectedBuiltInProfile.id);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectBuiltInProfile = async (profileId: BuiltInPresetId) => {
    setBuiltInProfileId(profileId);
    try {
      const res = await apiFetch<{ activeMode: 'byok' | 'builtin_open_weights' }>(
        `/tenants/${tenantId}/ai/builtin/profile`,
        {
          method: 'POST',
          body: JSON.stringify({ profileId }),
        }
      );
      if (res?.activeMode) {
        setActiveAiMode(res.activeMode);
      }
    } catch {
      // Local state already updated optimistically
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleSaveCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      await apiFetch(`/tenants/${tenantId}/credentials`, {
        method: 'POST',
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: apiKeyInput || undefined,
          accountSid: accountSidInput || undefined,
          authToken: authTokenInput || undefined,
        }),
      });

      setApiKeyInput('');
      setAccountSidInput('');
      setAuthTokenInput('');
      fetchCredentials();
    } catch (err: any) {
      alert(err.message || 'Failed to save credential');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCredential = async (provider: string) => {
    if (!confirm(`Delete credential for ${provider}?`)) return;

    try {
      await apiFetch(`/tenants/${tenantId}/credentials/${provider}`, {
        method: 'DELETE',
      });
      fetchCredentials();
    } catch (err: any) {
      alert(err.message || 'Failed to delete credential');
    }
  };

  const getCredentialFor = (provider: string) =>
    credentials.find((c) => c.provider === provider);

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Built-In AI & BYOK Integrations</h1>
        <p className="text-sm text-slate-500">
          Zero-key built-in open-weights AI (Qwen 2.5 Instruct, Apache 2.0) with optional Bring-Your-Own-Key (BYOK) cloud overrides
        </p>
      </div>

      {/* Built-In Open-Weights AI Card */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Built-In Open-Weights AI (Zero-Key Default)
              </h2>
              <p className="text-xs text-slate-500">
                Automatically powers Voice, Chat, SMS, Email, and Multi-Agent Routing when no BYOK cloud key is set
              </p>
            </div>
          </div>
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full ${
              activeAiMode === 'builtin_open_weights'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-sky-100 text-sky-800'
            }`}
          >
            {activeAiMode === 'builtin_open_weights'
              ? `Active Default (${builtInProfileId})`
              : 'Standby (BYOK Override Active)'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
          {BUILT_IN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleSelectBuiltInProfile(preset.id)}
              className={`text-left p-4 rounded-xl border transition-all ${
                builtInProfileId === preset.id
                  ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold text-sm text-slate-900">{preset.title}</span>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded whitespace-nowrap ${preset.badgeColor}`}>
                  {preset.badge}
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-500 mt-1">{preset.specs}</p>
              <p className="text-xs text-slate-600 mt-1.5">{preset.description}</p>
              <p className="text-[11px] text-slate-400 font-mono mt-2">
                Model ID: {preset.id}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 rounded-xl bg-slate-900 text-slate-200 text-xs flex items-center gap-3">
        <Lock className="w-5 h-5 text-sky-400 flex-shrink-0" />
        <div>
          <p className="font-semibold text-white">Authenticated Zero-Knowledge Storage</p>
          <p className="text-slate-400 mt-0.5">
            Provider credentials are encrypted at rest with AES-256-GCM using your cluster master key. Raw keys are never logged or returned to client browsers.
          </p>
        </div>
      </div>

      {/* Add / Update Form */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-sky-600" />
          <span>Configure Provider Credentials</span>
        </h2>

        <form onSubmit={handleSaveCredential} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              Select Provider
            </label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="openai">OpenAI (GPT-4o, GPT-4o-mini)</option>
              <option value="anthropic">Anthropic (Claude 3.5 Sonnet / Haiku)</option>
              <option value="gemini">Google Gemini (Gemini 1.5 Flash)</option>
              <option value="groq">Groq (Llama 3.3 70B Fast Inference)</option>
              <option value="twilio">Twilio Telephony (Inbound Voice & Transfers)</option>
            </select>
          </div>

          {selectedProvider === 'twilio' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Twilio Account SID
                </label>
                <input
                  type="text"
                  required
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={accountSidInput}
                  onChange={(e) => setAccountSidInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Twilio Auth Token
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••••••••••••••••••••••"
                  value={authTokenInput}
                  onChange={(e) => setAuthTokenInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                API Key
              </label>
              <input
                type="password"
                required
                placeholder="sk-••••••••••••••••••••••••"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg text-sm shadow-sm transition-colors disabled:opacity-50"
            >
              {isSaving ? 'Encrypting & Saving...' : 'Save Encrypted Key'}
            </button>
          </div>
        </form>
      </div>

      {/* Configured Integrations List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Configured Providers ({credentials.length})
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {['openai', 'anthropic', 'gemini', 'groq', 'twilio'].map((provider) => {
            const cred = getCredentialFor(provider);
            const isConfigured = Boolean(cred);

            return (
              <div key={provider} className="p-5 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 capitalize text-sm">{provider}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        isConfigured
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {isConfigured ? 'Active & Encrypted' : 'Not Configured'}
                    </span>
                  </div>

                  {cred?.metadata && (
                    <p className="text-xs text-slate-500 font-mono mt-1">
                      Masked Key: {cred.metadata.maskedKey || cred.metadata.maskedSid || '••••••••'}
                    </p>
                  )}
                </div>

                {isConfigured && (
                  <button
                    onClick={() => handleDeleteCredential(provider)}
                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title="Remove Credential"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
