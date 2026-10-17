'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  Lock,
} from 'lucide-react';

interface IntegrationCredential {
  id: string;
  provider: string;
  status: string;
  metadata?: any;
  updatedAt: string;
}

export default function IntegrationsPage() {
  const [credentials, setCredentials] = useState<IntegrationCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [accountSidInput, setAccountSidInput] = useState('');
  const [authTokenInput, setAuthTokenInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const tenantId = typeof window !== 'undefined'
    ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
    : 'tenant_acme_hvac_001';

  const fetchCredentials = async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch<{ credentials: IntegrationCredential[] }>(
        `/tenants/${tenantId}/credentials`
      );
      setCredentials(data.credentials || []);
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
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
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">BYOK Integrations & API Keys</h1>
        <p className="text-sm text-slate-500">
          Bring Your Own Keys: Connect your telephony and AI model providers securely with AES-256-GCM encryption
        </p>
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
