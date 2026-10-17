'use client';

import React, { useState } from 'react';
import {
  CreditCard,
  Zap,
  PhoneCall,
  Check,
  TrendingUp,
  Receipt,
  Shield,
  Layers,
  ArrowUpRight,
} from 'lucide-react';

export default function BillingPage() {
  const [selectedTier, setSelectedTier] = useState<'starter' | 'pro' | 'enterprise'>('pro');

  const voiceMinutesUsed = 1420;
  const voiceMinutesQuota = 3000;
  const voicePercent = Math.round((voiceMinutesUsed / voiceMinutesQuota) * 100);

  const tokensUsed = 482000;
  const tokensQuota = 1000000;
  const tokensPercent = Math.round((tokensUsed / tokensQuota) * 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Subscription & Consumption Metering
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Monitor real-time voice minute usage, AI token consumption, overage rates, and subscription tier settings.
        </p>
      </div>

      {/* Top Cards: Current Plan & Invoice Estimation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Current Plan Overview */}
        <div className="lg:col-span-2 bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-2xl shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="bg-sky-500/20 text-sky-400 border border-sky-400/30 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider">
                Current Subscription
              </span>
              <span className="text-xs text-slate-400">Renews on Nov 1, 2026</span>
            </div>
            <span className="text-2xl font-extrabold text-white">\$199 / mo</span>
          </div>

          <div>
            <h2 className="text-xl font-bold">Pro Organization Tier</h2>
            <p className="text-xs text-slate-300 mt-1">
              Includes 3,000 voice minutes, 1,000,000 AI tokens, priority call routing, and CRM webhooks.
            </p>
          </div>

          {/* Quota Bars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 flex items-center gap-1.5 font-medium">
                  <PhoneCall className="w-3.5 h-3.5 text-sky-400" /> Voice Minutes
                </span>
                <span className="font-semibold text-white">
                  {voiceMinutesUsed.toLocaleString()} / {voiceMinutesQuota.toLocaleString()} ({voicePercent}%)
                </span>
              </div>
              <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-sky-400 h-full rounded-full transition-all"
                  style={{ width: `${voicePercent}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-400 block">
                Overage rate: \$0.035 / min after quota
              </span>
            </div>

            <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 flex items-center gap-1.5 font-medium">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> AI Tokens
                </span>
                <span className="font-semibold text-white">
                  {(tokensUsed / 1000).toFixed(0)}k / {(tokensQuota / 1000).toFixed(0)}k ({tokensPercent}%)
                </span>
              </div>
              <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-amber-400 h-full rounded-full transition-all"
                  style={{ width: `${tokensPercent}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-400 block">
                Overage rate: \$0.002 / 1k tokens after quota
              </span>
            </div>
          </div>
        </div>

        {/* Invoice Summary */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-semibold mb-4">
              <Receipt className="w-5 h-5 text-sky-600" />
              <span>Current Cycle Estimate</span>
            </div>

            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span>Base Plan (Pro)</span>
                <span className="font-semibold text-slate-900">\$199.00</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span>Voice Overage (0 min)</span>
                <span className="font-semibold text-slate-900">\$0.00</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span>AI Token Overage (0 tokens)</span>
                <span className="font-semibold text-slate-900">\$0.00</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span>Active Seats (4 included)</span>
                <span className="font-semibold text-slate-900">\$0.00</span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200">
            <div className="flex justify-between items-baseline mb-3">
              <span className="text-xs font-bold text-slate-900 uppercase">Estimated Total</span>
              <span className="text-xl font-extrabold text-slate-900">\$199.00</span>
            </div>
            <button className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" />
              <span>Manage Stripe Billing</span>
            </button>
          </div>
        </div>
      </div>

      {/* Subscription Tier Comparison */}
      <div className="space-y-4 pt-4">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Layers className="w-5 h-5 text-sky-600" />
          <span>Available Subscription Plans</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Starter Plan */}
          <div
            className={`p-6 rounded-2xl border transition-all ${
              selectedTier === 'starter'
                ? 'border-sky-500 bg-sky-50/20 shadow-md ring-2 ring-sky-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-slate-900 text-base">Starter</h3>
              <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded">
                Self-Hosted
              </span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mb-4">
              \$49 <span className="text-xs text-slate-500 font-normal">/ month</span>
            </div>

            <ul className="space-y-2.5 text-xs text-slate-600 mb-6">
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>500 Voice Minutes / month</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>100,000 AI Tokens / month</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>1 Phone Number DID</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Up to 2 Agent Seats</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Standard Email Support</span>
              </li>
            </ul>

            <button
              onClick={() => setSelectedTier('starter')}
              className="w-full py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
            >
              Downgrade to Starter
            </button>
          </div>

          {/* Pro Plan */}
          <div
            className={`p-6 rounded-2xl border relative transition-all ${
              selectedTier === 'pro'
                ? 'border-sky-500 bg-sky-50/20 shadow-md ring-2 ring-sky-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-sky-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-sm">
              Current Plan
            </div>

            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-slate-900 text-base">Pro Organization</h3>
              <span className="text-xs bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded">
                Popular
              </span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mb-4">
              \$199 <span className="text-xs text-slate-500 font-normal">/ month</span>
            </div>

            <ul className="space-y-2.5 text-xs text-slate-600 mb-6">
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span><strong>3,000 Voice Minutes</strong> / month</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span><strong>1,000,000 AI Tokens</strong> / month</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Up to 10 Agent Seats</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>ACD Queues & Skills-Based Routing</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>CRM Webhooks (HubSpot, Zendesk)</span>
              </li>
            </ul>

            <button
              disabled
              className="w-full py-2 bg-sky-600 text-white text-xs font-semibold rounded-lg opacity-90 cursor-default"
            >
              Active Subscription
            </button>
          </div>

          {/* Enterprise Plan */}
          <div
            className={`p-6 rounded-2xl border transition-all ${
              selectedTier === 'enterprise'
                ? 'border-sky-500 bg-sky-50/20 shadow-md ring-2 ring-sky-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-slate-900 text-base">Enterprise</h3>
              <span className="text-xs bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded">
                Custom SLA
              </span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mb-4">Custom</div>

            <ul className="space-y-2.5 text-xs text-slate-600 mb-6">
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Unlimited Minutes & AI Tokens</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Dedicated SIP Trunks & PBX Interconnect</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Unlimited Agent Seats</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>99.99% Availability SLA</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Dedicated Enterprise Success Manager</span>
              </li>
            </ul>

            <button
              onClick={() => setSelectedTier('enterprise')}
              className="w-full py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1"
            >
              <span>Contact Sales</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
