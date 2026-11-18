'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  MessageCircle,
  Send,
  Bot,
  User,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';

interface ChatMessage {
  id: string;
  sender: 'customer' | 'ai';
  text: string;
  sources?: Array<{ title: string; sourceUri?: string }>;
}

export default function ChatWidgetPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [businessName, setBusinessName] = useState('Acme Heating & Air Conditioning');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [brandColor, setBrandColor] = useState('#0284c7');
  const [widgetPosition, setWidgetPosition] = useState<'bottom-right' | 'bottom-left'>('bottom-right');
  const [defaultLocale, setDefaultLocale] = useState<'en-US' | 'es-US' | 'fr-FR'>('en-US');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const embedScriptSnippet = `<script
  src="https://cdn.acme-hvac.example.com/widget.js"
  data-tenant-slug="acme-hvac"
  data-brand-color="${brandColor}"
  data-position="${widgetPosition}"
  data-locale="${defaultLocale}"
  async
></script>`;

  useEffect(() => {
    const initChat = async () => {
      try {
        const res = await apiFetch<{
          sessionId: string;
          businessName: string;
          greeting: string;
        }>('/chat/public/session', {
          method: 'POST',
          body: JSON.stringify({
            tenantSlug: 'acme-hvac',
            customerName: 'Demo Web Visitor',
          }),
        });

        setSessionId(res.sessionId);
        setBusinessName(res.businessName);
        setMessages([
          {
            id: 'init_greeting',
            sender: 'ai',
            text: res.greeting,
          },
        ]);
      } catch (err: any) {
        console.error('Failed to init public chat session:', err);
      } finally {
        setIsInitializing(false);
      }
    };

    initChat();
  }, []);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !inputMessage.trim()) return;

    const userText = inputMessage.trim();
    setInputMessage('');
    setIsLoading(true);

    const tempId = `cust_${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, sender: 'customer', text: userText }]);

    try {
      const res = await apiFetch<{
        reply: { id: string; content: string };
        sources: any[];
      }>('/chat/public/message', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          content: userText,
        }),
      });

      setMessages((prev) => [
        ...prev,
        {
          id: res.reply.id,
          sender: 'ai',
          text: res.reply.content,
          sources: res.sources,
        },
      ]);
    } catch (err: any) {
      alert(err.message || 'Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg mb-4 flex items-center justify-between">
        <Link
          href="/overview"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>
        <span className="text-xs text-sky-400 font-mono">Website Embed Widget Preview</span>
      </div>

      <div className="w-full max-w-lg bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[600px]">
        {/* Widget Header */}
        <div className="bg-sky-600 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-tight">{businessName}</h2>
              <span className="text-[11px] text-sky-100 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
                AI Support Online
              </span>
            </div>
          </div>
        </div>

        {/* Widget Messages */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50">
          {isInitializing ? (
            <p className="text-xs text-slate-400 text-center py-8">Connecting to customer support...</p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'customer' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`p-3 rounded-2xl text-xs max-w-[85%] leading-relaxed ${
                    m.sender === 'customer'
                      ? 'bg-sky-600 text-white rounded-br-sm'
                      : 'bg-white text-slate-800 shadow-sm border border-slate-200 rounded-bl-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>

                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] text-slate-500">
                      <span className="font-semibold block mb-0.5">Verified Source:</span>
                      <span>{m.sources[0].title}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Widget Input */}
        <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-200 flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isLoading || isInitializing}
            placeholder="Type your message here..."
            className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
          <button
            type="submit"
            disabled={isLoading || !inputMessage.trim()}
            className="p-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-sm transition-colors disabled:opacity-50"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      <div className="mt-4 text-center text-xs text-slate-400">
        Reuses identical Conversation Engine, Knowledge Base, and Safety Guardrails as Inbound Voice.
      </div>

      {/* Visual Widget Customizer & Embed Snippet Generator */}
      <div className="w-full max-w-lg mt-6 bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Visual Widget Customizer & Embed Code</h3>
          <span className="text-[11px] font-mono text-sky-400">{defaultLocale} • {widgetPosition}</span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Brand Color</label>
            <input
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="w-full h-8 rounded cursor-pointer bg-slate-900 border border-slate-700"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Position</label>
            <select
              value={widgetPosition}
              onChange={(e) => setWidgetPosition(e.target.value as any)}
              className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-white"
            >
              <option value="bottom-right">Bottom Right</option>
              <option value="bottom-left">Bottom Left</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Default Locale</label>
            <select
              value={defaultLocale}
              onChange={(e) => setDefaultLocale(e.target.value as any)}
              className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-white"
            >
              <option value="en-US">English (en-US)</option>
              <option value="es-US">Español (es-US)</option>
              <option value="fr-FR">Français (fr-FR)</option>
            </select>
          </div>
        </div>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[11px] text-emerald-400 overflow-x-auto">
          <pre>{embedScriptSnippet}</pre>
        </div>

        <button
          type="button"
          onClick={() => {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              navigator.clipboard.writeText(embedScriptSnippet);
            }
            setCopiedSnippet(true);
            setTimeout(() => setCopiedSnippet(false), 3000);
          }}
          className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold transition-colors"
        >
          {copiedSnippet ? '✓ Copied Embed Snippet to Clipboard' : 'Copy <script> Embed Snippet'}
        </button>
      </div>
    </div>
  );
}
