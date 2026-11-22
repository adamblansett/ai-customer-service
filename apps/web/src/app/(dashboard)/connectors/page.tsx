'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  ShoppingBag,
  Ticket,
  Calendar,
  Share2,
  Plus,
  Download,
} from 'lucide-react';

export default function OmnichannelConnectorsPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<any[]>([]);

  const [orderNumber, setOrderNumber] = useState('ORD-20481');
  const [ticketSubject, setTicketSubject] = useState('Compressor Capacitor Warranty Claim');
  const [ticketProvider, setTicketProvider] = useState<'zendesk' | 'jira' | 'servicenow'>('zendesk');
  const [techName, setTechName] = useState('Marcus Vance');
  const [calProvider, setCalProvider] = useState<'google_calendar' | 'microsoft_365'>('google_calendar');

  const tenantId =
    typeof window !== 'undefined'
      ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
      : 'tenant_acme_hvac_001';

  const loadAll = async () => {
    const [oRes, tRes, cRes] = await Promise.all([
      apiFetch<{ orders: any[] }>(`/tenants/${tenantId}/connectors/orders`).catch(() => ({ orders: [] })),
      apiFetch<{ tickets: any[] }>(`/tenants/${tenantId}/connectors/tickets`).catch(() => ({ tickets: [] })),
      apiFetch<{ connections: any[] }>(`/tenants/${tenantId}/connectors/calendars`).catch(() => ({ connections: [] })),
    ]);
    setOrders(oRes.orders || []);
    setTickets(tRes.tickets || []);
    setCalendars(cRes.connections || []);
  };

  useEffect(() => {
    loadAll();
  }, [tenantId]);

  const handleSeedOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/tenants/${tenantId}/connectors/orders`, {
      method: 'POST',
      body: JSON.stringify({
        provider: 'shopify',
        orderNumber,
        fulfillmentStatus: 'in_transit',
        totalCents: 18900,
        trackingNumber: '1Z999AA1019948210',
        returnEligible: true,
      }),
    }).catch(() => null);
    loadAll();
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/tenants/${tenantId}/connectors/tickets`, {
      method: 'POST',
      body: JSON.stringify({
        provider: ticketProvider,
        subject: ticketSubject,
        description: 'Escalated from AI Voice Triage for specialist warranty verification.',
        priority: 'high',
      }),
    }).catch(() => null);
    loadAll();
  };

  const handleConnectCalendar = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/tenants/${tenantId}/connectors/calendars`, {
      method: 'POST',
      body: JSON.stringify({
        provider: calProvider,
        calendarId: `${techName.toLowerCase().replace(/\s+/g, '.')}@company.com`,
        technicianName: techName,
        busyWindows: [],
      }),
    }).catch(() => null);
    loadAll();
  };

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          E-Commerce, Helpdesk, Calendar & Social Connectors
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Live Shopify/WooCommerce order lookups, Zendesk/Jira/ServiceNow ticket sync, Google/M365 technician calendars, and Social DM webhooks.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Shopify & WooCommerce Orders */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-emerald-600" />
              <span>Shopify & WooCommerce Orders</span>
            </h2>
            <span className="text-[11px] font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200">
              AI Tool: check_order_status
            </span>
          </div>

          <form onSubmit={handleSeedOrder} className="flex gap-2">
            <input
              type="text"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs"
              placeholder="ORD-20481"
            />
            <button
              type="submit"
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Sync Order
            </button>
          </form>

          <div className="divide-y divide-slate-200 text-xs">
            {orders.map((o) => (
              <div key={o.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-900">{o.orderNumber}</span>
                  <span className="ml-2 uppercase text-[10px] font-semibold text-slate-500">
                    {o.provider}
                  </span>
                </div>
                <span className="font-mono text-sky-700 bg-sky-50 px-2 py-0.5 rounded">
                  {o.fulfillmentStatus}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Zendesk / Jira / ServiceNow Tickets */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Ticket className="w-4 h-4 text-indigo-600" />
              <span>Zendesk, Jira & ServiceNow Tickets</span>
            </h2>
            <span className="text-[11px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200">
              AI Tool: create_support_ticket
            </span>
          </div>

          <form onSubmit={handleCreateTicket} className="flex gap-2">
            <select
              value={ticketProvider}
              onChange={(e) => setTicketProvider(e.target.value as any)}
              className="px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
            >
              <option value="zendesk">Zendesk</option>
              <option value="jira">Jira</option>
              <option value="servicenow">ServiceNow</option>
            </select>
            <input
              type="text"
              value={ticketSubject}
              onChange={(e) => setTicketSubject(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs"
            />
            <button
              type="submit"
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg"
            >
              Create
            </button>
          </form>

          <div className="divide-y divide-slate-200 text-xs">
            {tickets.map((t) => (
              <div key={t.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-mono font-bold text-indigo-700">{t.externalKey}</span>
                  <span className="ml-2 text-slate-800">{t.subject}</span>
                </div>
                <span className="text-[11px] text-slate-500">{t.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Two-Way Technician Calendar Sync */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-sky-600" />
              <span>Google Calendar & Microsoft 365 Sync</span>
            </h2>
            <a
              href={`${apiBase}/tenants/${tenantId}/appointments/ical.ics`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline"
            >
              <Download className="w-3.5 h-3.5" /> RFC 5545 .ics Feed
            </a>
          </div>

          <form onSubmit={handleConnectCalendar} className="flex gap-2">
            <select
              value={calProvider}
              onChange={(e) => setCalProvider(e.target.value as any)}
              className="px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
            >
              <option value="google_calendar">Google Calendar</option>
              <option value="microsoft_365">Microsoft 365</option>
            </select>
            <input
              type="text"
              value={techName}
              onChange={(e) => setTechName(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs"
            />
            <button
              type="submit"
              className="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg"
            >
              Link Calendar
            </button>
          </form>

          <div className="divide-y divide-slate-200 text-xs">
            {calendars.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between">
                <span className="font-semibold text-slate-800">
                  {c.technicianName} ({c.provider})
                </span>
                <span className="text-emerald-700 font-mono">{c.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Social Messaging Channels */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Share2 className="w-4 h-4 text-purple-600" />
            <span>Social Messaging Channel Webhooks</span>
          </h2>
          <p className="text-xs text-slate-600">
            Point Apple Messages for Business, Meta Instagram/Messenger, and Slack Connect customer channels to these HMAC-verified endpoints:
          </p>
          <div className="space-y-2 font-mono text-[11px] bg-slate-950 text-slate-200 p-3.5 rounded-xl">
            <div>POST /api/v1/social/{tenantId}/apple_business</div>
            <div>POST /api/v1/social/{tenantId}/instagram_dm</div>
            <div>POST /api/v1/social/{tenantId}/facebook_messenger</div>
            <div>POST /api/v1/social/{tenantId}/slack_connect</div>
          </div>
        </div>
      </div>
    </div>
  );
}
