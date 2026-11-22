'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, setAuthToken } from '@/lib/api-client';
import { ShieldCheck, Sparkles, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';

const INDUSTRIES = [
  { id: 'hvac', label: 'HVAC, Plumbing & Field Dispatch' },
  { id: 'dental', label: 'Dental & Medical Clinic Reception' },
  { id: 'ecommerce', label: 'E-Commerce & Retail Order Support' },
  { id: 'property_management', label: 'Property Management & Leasing' },
  { id: 'saas_support', label: 'B2B SaaS Technical Support' },
] as const;

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [industry, setIndustry] = useState<string>('hvac');
  const [tier, setTier] = useState<'starter' | 'pro' | 'enterprise'>('pro');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const res = await apiFetch<{
        token: string;
        tenant: { id: string; name: string; slug: string };
        user: any;
      }>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          companyName,
          ownerName,
          ownerEmail,
          password,
          industry,
          tier,
        }),
      });

      setAuthToken(res.token);
      localStorage.setItem('active_tenant_id', res.tenant.id);
      localStorage.setItem('active_tenant_name', res.tenant.name);
      localStorage.setItem('current_user', JSON.stringify(res.user));

      router.push('/onboarding');
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not create workspace.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-900 px-4 py-12">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl p-8 border border-slate-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-sky-600 text-white flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Launch Your AI Contact Center</h1>
              <p className="text-xs text-slate-500">
                14-day Pro trial • Built-in Open-Weights AI & Speech • Zero API keys required
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            <Sparkles className="w-3.5 h-3.5" /> 60s Setup
          </span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="companyName" className="block text-xs font-semibold text-slate-700 mb-1">
                Organization Name
              </label>
              <input
                id="companyName"
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Summit Climate Systems"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
              />
            </div>
            <div>
              <label htmlFor="ownerName" className="block text-xs font-semibold text-slate-700 mb-1">
                Your Full Name
              </label>
              <input
                id="ownerName"
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Jordan Taylor"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ownerEmail" className="block text-xs font-semibold text-slate-700 mb-1">
                Work Email
              </label>
              <input
                id="ownerEmail"
                type="email"
                required
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="jordan@summit-climate.com"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-slate-700 mb-1">
                Password (8+ chars)
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="industry" className="block text-xs font-semibold text-slate-700 mb-1">
                Industry Starter Pack
              </label>
              <select
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm bg-white"
              >
                {INDUSTRIES.map((ind) => (
                  <option key={ind.id} value={ind.id}>
                    {ind.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tier" className="block text-xs font-semibold text-slate-700 mb-1">
                Subscription Tier (14-Day Free Trial)
              </label>
              <select
                id="tier"
                value={tier}
                onChange={(e) => setTier(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm bg-white"
              >
                <option value="starter">Starter (\$49/mo after trial)</option>
                <option value="pro">Pro Organization (\$199/mo after trial)</option>
                <option value="enterprise">Enterprise SLA (Custom)</option>
              </select>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
            <p className="font-semibold text-slate-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Auto-provisioned in your isolated tenant workspace:
            </p>
            <p>
              • Pre-indexed Hybrid RAG Knowledge Base + IVR Call Flow DAG • Qwen 2.5 7B + Kokoro-82M Voice • PostgreSQL Row-Level Security
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-lg shadow transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            <span>{isSubmitting ? 'Provisioning Workspace...' : 'Create Workspace & Start Onboarding'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200 text-center text-xs text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="text-sky-600 hover:underline font-semibold">
            Sign in to Console
          </Link>
        </div>
      </div>
    </main>
  );
}
