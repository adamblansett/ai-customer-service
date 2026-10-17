'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  Users,
  Search,
  Phone,
  Mail,
  Calendar,
  MessageSquare,
  Sparkles,
  Star,
  Clock,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  GitMerge,
  ChevronRight,
} from 'lucide-react';

interface JourneyItem {
  id: string;
  channel: 'voice' | 'chat' | 'sms' | 'email' | 'whatsapp';
  direction: 'inbound' | 'outbound';
  timestamp: string;
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  csatScore?: number;
  agentName: string;
}

interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  totalConversations: number;
  averageCsat: number;
  lifetimeSentiment: 'positive' | 'neutral' | 'negative';
  lastSeen: string;
  journey: JourneyItem[];
}

const MOCK_CUSTOMERS: CustomerRecord[] = [
  {
    id: 'cust-001',
    name: 'Eleanor Vance',
    phone: '+1 (555) 349-2041',
    email: 'eleanor.vance@example.com',
    totalConversations: 4,
    averageCsat: 4.8,
    lifetimeSentiment: 'positive',
    lastSeen: '10 min ago',
    journey: [
      {
        id: 'j-1',
        channel: 'voice',
        direction: 'inbound',
        timestamp: 'Today, 2:45 PM',
        summary: 'Emergency heater failure reported. Guided through preliminary filter & thermostat check.',
        sentiment: 'positive',
        csatScore: 5,
        agentName: 'AI Voice Assistant',
      },
      {
        id: 'j-2',
        channel: 'sms',
        direction: 'outbound',
        timestamp: 'Today, 2:48 PM',
        summary: 'Technician dispatch arrival confirmation SMS with live tracking link sent.',
        sentiment: 'neutral',
        agentName: 'System Broadcast',
      },
      {
        id: 'j-3',
        channel: 'chat',
        direction: 'inbound',
        timestamp: 'Yesterday, 11:20 AM',
        summary: 'Customer verified invoice receipt and confirmed scheduled maintenance tier.',
        sentiment: 'positive',
        csatScore: 5,
        agentName: 'Billing & Payments Specialist',
      },
      {
        id: 'j-4',
        channel: 'email',
        direction: 'inbound',
        timestamp: 'Oct 12, 4:15 PM',
        summary: 'Warranty registration submission for newly installed heat pump condenser.',
        sentiment: 'positive',
        csatScore: 4,
        agentName: 'Sarah Jenkins (Agent)',
      },
    ],
  },
  {
    id: 'cust-002',
    name: 'Marcus Vance',
    phone: '+1 (555) 892-1140',
    email: 'marcus.v@acme-hvac.example.com',
    totalConversations: 2,
    averageCsat: 4.0,
    lifetimeSentiment: 'neutral',
    lastSeen: 'Yesterday',
    journey: [
      {
        id: 'j-5',
        channel: 'whatsapp',
        direction: 'inbound',
        timestamp: 'Yesterday, 9:30 AM',
        summary: 'Requested filter replacement specifications for Lennox XC21 air conditioner.',
        sentiment: 'neutral',
        csatScore: 4,
        agentName: 'Technical Troubleshooting Agent',
      },
      {
        id: 'j-6',
        channel: 'sms',
        direction: 'outbound',
        timestamp: 'Yesterday, 9:35 AM',
        summary: 'Parts order link dispatched via SMS with 15% recurring subscriber discount.',
        sentiment: 'positive',
        agentName: 'Automated Dispatch',
      },
    ],
  },
  {
    id: 'cust-003',
    name: 'Arthur Pendelton',
    phone: '+1 (555) 444-3333',
    email: 'arthur.p@example.com',
    totalConversations: 1,
    averageCsat: 2.0,
    lifetimeSentiment: 'negative',
    lastSeen: '3 days ago',
    journey: [
      {
        id: 'j-7',
        channel: 'voice',
        direction: 'inbound',
        timestamp: 'Oct 14, 1:10 PM',
        summary: 'Caller expressed frustration with technician arrival delay during severe storm.',
        sentiment: 'negative',
        csatScore: 2,
        agentName: 'Escalated to Supervisor',
      },
    ],
  },
];

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRecord[]>(MOCK_CUSTOMERS);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(MOCK_CUSTOMERS[0].id);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    apiFetch<{ customers: any[] }>('/tenants/tenant_acme_hvac_001/customers')
      .then((res) => {
        if (res.customers && res.customers.length > 0) {
          const liveRecords: CustomerRecord[] = res.customers.map((c: any) => ({
            id: c.id,
            name: c.name || 'Customer',
            phone: c.phoneNumber || '+1 (555) 000-0000',
            email: c.email || 'customer@example.com',
            totalConversations: 1,
            averageCsat: 4.5,
            lifetimeSentiment: 'positive',
            lastSeen: 'Active',
            journey: MOCK_CUSTOMERS[0].journey,
          }));
          setCustomers([...liveRecords, ...MOCK_CUSTOMERS]);
        }
      })
      .catch(() => {
        // Fallback to local MOCK_CUSTOMERS when API is offline
      });
  }, []);

  const selectedCustomer =
    customers.find((c) => c.id === selectedCustomerId) || customers[0];

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getChannelBadge = (channel: JourneyItem['channel']) => {
    switch (channel) {
      case 'voice':
        return <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded font-medium">Voice Call</span>;
      case 'sms':
        return <span className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 rounded font-medium">SMS Text</span>;
      case 'chat':
        return <span className="px-2 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded font-medium">Website Chat</span>;
      case 'email':
        return <span className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 rounded font-medium">Email Thread</span>;
      case 'whatsapp':
        return <span className="px-2 py-0.5 text-xs bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 rounded font-medium">WhatsApp</span>;
    }
  };

  const getSentimentBadge = (sentiment: 'positive' | 'neutral' | 'negative') => {
    switch (sentiment) {
      case 'positive':
        return <span className="px-2 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded font-medium">Positive</span>;
      case 'neutral':
        return <span className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded font-medium">Neutral</span>;
      case 'negative':
        return <span className="px-2 py-0.5 text-xs bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 rounded font-medium">Frustrated</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Omnichannel Customer 360 & Timeline
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Unified cross-channel customer identities, interaction history, and CSAT sentiment tracking.
          </p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer Directory */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search by name, phone, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            />
          </div>

          <div className="space-y-2">
            {filteredCustomers.map((c) => {
              const isSelected = c.id === selectedCustomerId;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedCustomerId(c.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-500 ring-2 ring-blue-500/20'
                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{c.name}</h3>
                    {getSentimentBadge(c.lifetimeSentiment)}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{c.phone}</p>
                  <p className="text-xs text-zinc-400">{c.email}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                    <span>{c.totalConversations} Interactions</span>
                    <span className="flex items-center gap-1 font-semibold text-amber-500">
                      <Star className="w-3.5 h-3.5 fill-current" /> {c.averageCsat}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Customer 360 Detail View */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile Overview Card */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-lg">
                  {selectedCustomer.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {selectedCustomer.name}
                    </h2>
                    {getSentimentBadge(selectedCustomer.lifetimeSentiment)}
                  </div>
                  <p className="text-xs text-zinc-400">Customer ID: {selectedCustomer.id}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 rounded-lg transition-colors">
                  <GitMerge className="w-3.5 h-3.5" /> Merge Identity
                </button>
              </div>
            </div>

            {/* Metrics Ribbon */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6">
              <div>
                <p className="text-xs font-medium text-zinc-400">Total Interactions</p>
                <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
                  {selectedCustomer.totalConversations}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400">Average CSAT</p>
                <p className="text-xl font-bold text-amber-500 mt-1 flex items-center gap-1">
                  <Star className="w-4 h-4 fill-current" /> {selectedCustomer.averageCsat}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400">Phone</p>
                <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 mt-2 truncate">
                  {selectedCustomer.phone}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400">Email</p>
                <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 mt-2 truncate">
                  {selectedCustomer.email}
                </p>
              </div>
            </div>
          </div>

          {/* Unified Journey Timeline */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                Omnichannel Interaction Timeline
              </h3>
              <span className="text-xs text-zinc-400">Chronological history across all channels</span>
            </div>

            <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-200 dark:before:bg-zinc-800">
              {selectedCustomer.journey.map((item) => (
                <div key={item.id} className="relative group">
                  {/* Timeline dot */}
                  <div className="absolute -left-6 top-1.5 w-2.5 h-2.5 rounded-full bg-blue-600 ring-4 ring-white dark:ring-zinc-900" />

                  <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/60 rounded-xl p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getChannelBadge(item.channel)}
                        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                          {item.direction}
                        </span>
                        <span className="text-xs text-zinc-400">• {item.timestamp}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.csatScore && (
                          <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
                            <Star className="w-3 h-3 fill-current" /> {item.csatScore}
                          </span>
                        )}
                        {getSentimentBadge(item.sentiment)}
                      </div>
                    </div>

                    <p className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed">
                      {item.summary}
                    </p>

                    <p className="text-[11px] text-zinc-400">
                      Handled by: <strong className="text-zinc-600 dark:text-zinc-300">{item.agentName}</strong>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
