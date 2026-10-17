'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  Settings,
  Clock,
  Shield,
  PhoneCall,
  Save,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const tenantId = typeof window !== 'undefined'
    ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
    : 'tenant_acme_hvac_001';

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await apiFetch<{ settings: any }>(`/tenants/${tenantId}/settings`);
        setSettings(data.settings || {});
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to load business settings.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, [tenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    setErrorMessage('');

    try {
      const res = await apiFetch<{ settings: any }>(`/tenants/${tenantId}/settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleHourChange = (day: string, field: 'open' | 'close' | 'closed', value: any) => {
    setSettings((prev: any) => {
      const currentHours = { ...(prev.businessHours || {}) };
      const dayData = { ...(currentHours[day] || { open: '09:00', close: '17:00', closed: false }) };
      dayData[field] = value;
      currentHours[day] = dayData;
      return { ...prev, businessHours: currentHours };
    });
  };

  if (isLoading) {
    return <p className="text-slate-400 text-sm">Loading business settings...</p>;
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Business & Operating Settings</h1>
        <p className="text-sm text-slate-500">
          Configure operating hours, AI identity disclosure, fallback phone destinations, and recording retention
        </p>
      </div>

      {saveSuccess && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>Business settings updated successfully.</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Core Business Information */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Settings className="w-4 h-4 text-sky-600" />
            <span>General Business Information</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Business Display Name
              </label>
              <input
                type="text"
                required
                value={settings?.businessName || ''}
                onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Business Timezone
              </label>
              <select
                value={settings?.timezone || 'America/New_York'}
                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="America/New_York">Eastern Time (America/New_York)</option>
                <option value="America/Chicago">Central Time (America/Chicago)</option>
                <option value="America/Denver">Mountain Time (America/Denver)</option>
                <option value="America/Los_Angeles">Pacific Time (America/Los_Angeles)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
        </div>

        {/* Operating Hours */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" />
            <span>Operating Hours Schedule</span>
          </h2>
          <p className="text-xs text-slate-500">
            Calls outside of these hours will automatically trigger after-hours routing (callback ticket or voicemail).
          </p>

          <div className="space-y-2 pt-2">
            {DAYS.map((day) => {
              const schedule = settings?.businessHours?.[day] || { open: '09:00', close: '17:00', closed: false };
              return (
                <div key={day} className="flex items-center gap-4 py-2 border-b border-slate-100 last:border-0 text-sm">
                  <span className="w-28 font-medium capitalize text-slate-700">{day}</span>

                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={schedule.closed}
                      onChange={(e) => handleHourChange(day, 'closed', e.target.checked)}
                      className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>Closed</span>
                  </label>

                  {!schedule.closed && (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={schedule.open || '09:00'}
                        onChange={(e) => handleHourChange(day, 'open', e.target.value)}
                        className="px-2 py-1 rounded border border-slate-300 text-xs"
                      />
                      <span className="text-xs text-slate-400">to</span>
                      <input
                        type="time"
                        value={schedule.close || '17:00'}
                        onChange={(e) => handleHourChange(day, 'close', e.target.value)}
                        className="px-2 py-1 rounded border border-slate-300 text-xs"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Voice Persona & Transfer Routing */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-sky-600" />
            <span>Voice & Transfer Configuration</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Human Transfer Destination Phone (E.164)
              </label>
              <input
                type="text"
                placeholder="+15550199"
                value={settings?.fallbackPhone || ''}
                onChange={(e) => setSettings({ ...settings, fallbackPhone: e.target.value })}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Destination phone for human agent handoffs.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Transfer Timeout (Seconds)
              </label>
              <input
                type="number"
                min={10}
                max={120}
                value={settings?.transferTimeoutSeconds || 30}
                onChange={(e) => setSettings({ ...settings, transferTimeoutSeconds: Number(e.target.value) })}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              AI Greeting Message
            </label>
            <textarea
              rows={2}
              value={settings?.aiGreeting || ''}
              onChange={(e) => setSettings({ ...settings, aiGreeting: e.target.value })}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2.5 text-sm text-slate-800 font-medium">
              <input
                type="checkbox"
                checked={settings?.identifyAsAi ?? true}
                onChange={(e) => setSettings({ ...settings, identifyAsAi: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-sky-600"
              />
              <span>Identify as AI Assistant (Legal compliance disclosure)</span>
            </label>
          </div>
        </div>

        {/* Privacy, Recording & Retention */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-600" />
            <span>Privacy, Recording & Data Retention</span>
          </h2>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              Call Recording Consent Announcement
            </label>
            <input
              type="text"
              value={settings?.recordingConsentText || ''}
              onChange={(e) => setSettings({ ...settings, recordingConsentText: e.target.value })}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2.5 text-sm text-slate-800 font-medium">
              <input
                type="checkbox"
                checked={settings?.recordingConsentRequired ?? true}
                onChange={(e) => setSettings({ ...settings, recordingConsentRequired: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-sky-600"
              />
              <span>Require Recording Consent Announcement on Inbound Calls</span>
            </label>

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>Retention Period:</span>
              <input
                type="number"
                min={7}
                max={365}
                value={settings?.retentionDays || 90}
                onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) })}
                className="w-16 px-2 py-1 rounded border border-slate-300 text-xs text-center font-bold"
              />
              <span>days</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg text-sm shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving...' : 'Save Business Settings'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
