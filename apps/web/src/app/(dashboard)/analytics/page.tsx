'use client';

import React, { useState } from 'react';
import {
  BarChart3,
  Smile,
  Frown,
  Meh,
  AlertTriangle,
  Star,
  CheckCircle,
  ShieldCheck,
  Tag,
  Phone,
  Clock,
  Sparkles,
} from 'lucide-react';

interface CallInsightItem {
  id: string;
  phoneNumber: string;
  durationSeconds: number;
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  csat: number;
  resolved: boolean;
  compliancePassed: boolean;
  topics: string[];
  summary: string;
  timestamp: string;
}

const RECENT_INSIGHTS: CallInsightItem[] = [
  {
    id: 'an-101',
    phoneNumber: '+1 (555) 349-2041',
    durationSeconds: 168,
    sentiment: 'positive',
    csat: 5,
    resolved: true,
    compliancePassed: true,
    topics: ['furnace-repair', 'emergency', 'scheduling'],
    summary:
      'Customer called with emergency heating loss in freezing temperatures. Assistant retrieved emergency technician protocol, identified available slot today at 2:00 PM, and scheduled dispatch with caller confirmation.',
    timestamp: '15 mins ago',
  },
  {
    id: 'an-102',
    phoneNumber: '+1 (555) 892-1140',
    durationSeconds: 215,
    sentiment: 'neutral',
    csat: 4,
    resolved: true,
    compliancePassed: true,
    topics: ['billing', 'invoice-inquiry'],
    summary:
      'Caller requested explanation of monthly filter subscription charge. Assistant verified invoice schedule and confirmed next delivery date.',
    timestamp: '42 mins ago',
  },
  {
    id: 'an-103',
    phoneNumber: '+1 (555) 231-9872',
    durationSeconds: 194,
    sentiment: 'frustrated',
    csat: 2,
    resolved: false,
    compliancePassed: true,
    topics: ['warranty-claim', 'escalation'],
    summary:
      'Caller sought warranty reimbursement for secondary plumbing leak. Assistant explained warranty boundaries, recognized caller dissatisfaction, and initiated warm transfer to senior operations supervisor.',
    timestamp: '1 hour ago',
  },
  {
    id: 'an-104',
    phoneNumber: '+1 (555) 762-0931',
    durationSeconds: 112,
    sentiment: 'positive',
    csat: 5,
    resolved: true,
    compliancePassed: true,
    topics: ['operating-hours', 'pricing'],
    summary:
      'Caller asked about standard seasonal tune-up rates and weekend availability. Assistant provided transparent \$89 tune-up pricing and Saturday operating hours.',
    timestamp: '2 hours ago',
  },
];

export default function AnalyticsPage() {
  const [insights] = useState<CallInsightItem[]>(RECENT_INSIGHTS);
  const [selectedSentimentFilter, setSelectedSentimentFilter] = useState<string>('all');

  const filteredInsights = insights.filter((item) => {
    if (selectedSentimentFilter === 'all') return true;
    return item.sentiment === selectedSentimentFilter;
  });

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Post-Call Analytics & CSAT Scoring
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Automated multi-turn sentiment analysis, customer satisfaction ratings, compliance auditing, and call summaries.
        </p>
      </div>

      {/* Top Level Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Average CSAT Score
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">4.6</span>
            <span className="text-xs text-slate-500">out of 5.0</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Positive Sentiment
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Smile className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">82%</span>
            <span className="text-xs text-emerald-600 font-semibold">+4.2% this week</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Compliance Adherence
            </span>
            <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">99.4%</span>
            <span className="text-xs text-slate-500">disclosure & consent</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              First-Contact Resolution
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">76%</span>
            <span className="text-xs text-slate-500">without human transfer</span>
          </div>
        </div>
      </div>

      {/* Middle Grid: Sentiment Breakdown & Compliance Auditing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sentiment Distribution */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-sky-600" />
            <span>Sentiment Distribution (Last 30 Days)</span>
          </h2>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                <span className="flex items-center gap-1.5">
                  <Smile className="w-3.5 h-3.5 text-emerald-600" /> Positive
                </span>
                <span>82%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full rounded-full" style={{ width: '82%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                <span className="flex items-center gap-1.5">
                  <Meh className="w-3.5 h-3.5 text-slate-500" /> Neutral
                </span>
                <span>12%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-slate-400 h-full rounded-full" style={{ width: '12%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                <span className="flex items-center gap-1.5">
                  <Frown className="w-3.5 h-3.5 text-amber-500" /> Negative
                </span>
                <span>4%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-amber-400 h-full rounded-full" style={{ width: '4%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" /> Frustrated
                </span>
                <span>2%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-rose-500 h-full rounded-full" style={{ width: '2%' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Regulatory & Policy Compliance */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Automated Regulatory Compliance Audit</span>
          </h2>

          <div className="space-y-4 pt-1">
            <div className="flex items-start justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div>
                <span className="text-sm font-semibold text-slate-800 block">
                  AI Identity Disclosure
                </span>
                <span className="text-xs text-slate-500">
                  Assistant unambiguously identified itself as an automated AI agent.
                </span>
              </div>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                100% Pass
              </span>
            </div>

            <div className="flex items-start justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div>
                <span className="text-sm font-semibold text-slate-800 block">
                  Call Recording Notice
                </span>
                <span className="text-xs text-slate-500">
                  Provided required two-party consent disclosure before conversational speech.
                </span>
              </div>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                99.2% Pass
              </span>
            </div>

            <div className="flex items-start justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div>
                <span className="text-sm font-semibold text-slate-800 block">
                  Cardholder / PII Redaction
                </span>
                <span className="text-xs text-slate-500">
                  Zero unmasked payment card numbers or SSNs detected in call transcripts.
                </span>
              </div>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                100% Pass
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Call Insights Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-sky-600" />
            <h2 className="text-base font-semibold text-slate-900">
              Recent Call Insights & AI Summaries
            </h2>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Filter Sentiment:</span>
            <select
              value={selectedSentimentFilter}
              onChange={(e) => setSelectedSentimentFilter(e.target.value)}
              className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 outline-none"
            >
              <option value="all">All Sentiments</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="frustrated">Frustrated</option>
            </select>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredInsights.map((item) => (
            <div key={item.id} className="p-5 hover:bg-slate-50/70 transition-colors space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-900 text-sm font-mono flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {item.phoneNumber}
                  </span>
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {item.durationSeconds}s
                  </span>
                  <span className="text-xs text-slate-400">• {item.timestamp}</span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Sentiment Badge */}
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1 ${
                      item.sentiment === 'positive'
                        ? 'bg-emerald-100 text-emerald-800'
                        : item.sentiment === 'neutral'
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {item.sentiment}
                  </span>

                  {/* CSAT Stars */}
                  <div className="flex items-center text-amber-400">
                    {Array.from({ length: item.csat }).map((_, idx) => (
                      <Star key={idx} className="w-3.5 h-3.5 fill-amber-400" />
                    ))}
                  </div>
                </div>
              </div>

              {/* AI Summary */}
              <p className="text-xs text-slate-600 leading-relaxed bg-slate-50/80 p-2.5 rounded-lg border border-slate-100">
                <strong className="text-slate-800">AI Summary:</strong> {item.summary}
              </p>

              {/* Topics */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <Tag className="w-3 h-3 text-slate-400" />
                {item.topics.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded font-mono"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
