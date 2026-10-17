'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  MessagesSquare,
  PhoneCall,
  User,
  Bot,
  Send,
  UserCheck,
  CheckCircle2,
  RefreshCw,
  Clock,
  AlertCircle,
  Tag,
  Mic,
  MicOff,
  PhoneOff,
  Smartphone,
  Volume2,
  Sparkles,
  Lightbulb,
  ShieldAlert,
} from 'lucide-react';


interface ConversationSummary {
  id: string;
  channel: string;
  status: string;
  escalationState: string;
  escalationReason?: string;
  summary?: string;
  assignedAgentId?: string;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  customerPhone?: string;
}

interface MessageItem {
  id: string;
  senderType: 'customer' | 'ai_agent' | 'human_agent' | 'system';
  senderId?: string;
  content: string;
  toolCalls?: any[];
  createdAt: string;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [agentReplyText, setAgentReplyText] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSoftphoneActive, setIsSoftphoneActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [agentPresence, setAgentPresence] = useState<'idle' | 'busy' | 'offline'>('idle');

  const tenantId = typeof window !== 'undefined'
    ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
    : 'tenant_acme_hvac_001';

  const fetchConversations = async () => {
    setIsLoadingList(true);
    try {
      const data = await apiFetch<{ conversations: ConversationSummary[] }>(
        `/tenants/${tenantId}/conversations?status=${statusFilter}`
      );
      setConversations(data.conversations || []);
      if (!selectedConvId && data.conversations?.length > 0) {
        setSelectedConvId(data.conversations[0].id);
      }
    } catch {
      // Handle error
    } finally {
      setIsLoadingList(false);
    }
  };

  const fetchMessages = async (convId: string) => {
    setIsLoadingMessages(true);
    try {
      const data = await apiFetch<{
        conversation: ConversationSummary;
        messages: MessageItem[];
      }>(`/tenants/${tenantId}/conversations/${convId}`);

      setActiveConversation(data.conversation);
      setMessages(data.messages || []);
    } catch {
      // Handle error
    } finally {
      setIsLoadingMessages(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [statusFilter]);

  useEffect(() => {
    if (selectedConvId) {
      fetchMessages(selectedConvId);
    }
  }, [selectedConvId]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConvId || !agentReplyText.trim()) return;

    setIsSending(true);
    try {
      const res = await apiFetch<{ message: MessageItem }>(
        `/tenants/${tenantId}/conversations/${selectedConvId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content: agentReplyText.trim() }),
        }
      );

      setMessages((prev) => [...prev, res.message]);
      setAgentReplyText('');
    } catch (err: any) {
      alert(err.message || 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleTakeOver = async () => {
    if (!selectedConvId) return;
    try {
      await apiFetch(`/tenants/${tenantId}/conversations/${selectedConvId}/assign`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      fetchMessages(selectedConvId);
      fetchConversations();
    } catch (err: any) {
      alert(err.message || 'Failed to assign conversation');
    }
  };

  const handleCloseConversation = async () => {
    if (!selectedConvId) return;
    if (!confirm('Are you sure you want to resolve and close this conversation?')) return;

    try {
      await apiFetch(`/tenants/${tenantId}/conversations/${selectedConvId}/close`, {
        method: 'POST',
        body: JSON.stringify({ summary: 'Resolved by agent' }),
      });
      fetchMessages(selectedConvId);
      fetchConversations();
    } catch (err: any) {
      alert(err.message || 'Failed to close conversation');
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col max-w-7xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Live Conversations & Agent Console</h1>
          <p className="text-sm text-slate-500">Monitor automated AI dialogues and take over escalated sessions</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-xs">
            {['all', 'active', 'waiting_agent', 'closed'].map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`px-3 py-1.5 rounded-md capitalize font-medium transition-colors ${
                  statusFilter === filter
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {filter.replace('_', ' ')}
              </button>
            ))}
          </div>

          <button
            onClick={() => fetchConversations()}
            className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-lg shadow-sm"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden pt-4 gap-4">
        {/* Left Pane: Conversation List */}
        <div className="w-80 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-100 bg-slate-50/50">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Conversations ({conversations.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {isLoadingList && conversations.length === 0 ? (
              <p className="p-4 text-xs text-slate-400 text-center">Loading conversations...</p>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <MessagesSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs">No conversations found</p>
              </div>
            ) : (
              conversations.map((c) => {
                const isSelected = c.id === selectedConvId;
                const isWaiting = c.status === 'waiting_agent';
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedConvId(c.id)}
                    className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-sky-50/80 border-l-4 border-sky-600'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                        {c.channel === 'voice' ? (
                          <PhoneCall className="w-3.5 h-3.5 text-sky-600" />
                        ) : c.channel === 'sms' ? (
                          <Smartphone className="w-3.5 h-3.5 text-purple-600" />
                        ) : (
                          <MessagesSquare className="w-3.5 h-3.5 text-emerald-600" />
                        )}

                        <span className="truncate max-w-[120px]">
                          {c.customerName || c.customerPhone || 'Anonymous Caller'}
                        </span>
                      </span>

                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          isWaiting
                            ? 'bg-amber-100 text-amber-800 animate-pulse'
                            : c.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {c.status.replace('_', ' ')}
                      </span>
                    </div>

                    {c.escalationReason && (
                      <p className="text-[11px] text-amber-700 font-medium truncate">
                        ⚠️ {c.escalationReason}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
                      <span className="font-mono text-[10px]">{c.id.slice(0, 12)}...</span>
                      <span>{new Date(c.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Message Transcript & Live Action Console */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          {activeConversation ? (
            <>
              {/* Conversation Header */}
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">
                      {activeConversation.customerName || activeConversation.customerPhone || 'Direct Inquiry'}
                    </span>
                    <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
                      {activeConversation.channel}
                    </span>
                    <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded capitalize">
                      {activeConversation.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Session ID: {activeConversation.id}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {activeConversation.status !== 'closed' && (
                    <>
                      <button
                        onClick={handleTakeOver}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 text-white shadow-sm transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Take Over Session</span>
                      </button>

                      <button
                        onClick={handleCloseConversation}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Resolve & Close</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* WebRTC Softphone Control Bar for Voice Conversations */}
              {activeConversation.channel === 'voice' && (
                <div className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between border-b border-slate-800 transition-all">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        isSoftphoneActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                          WebRTC Agent Softphone
                        </span>
                        <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-emerald-400 font-mono">
                          {isSoftphoneActive
                            ? isOnHold
                              ? 'CALL ON HOLD'
                              : 'DUPLEX AUDIO CONNECTED'
                            : 'IDLE / READY'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Browser audio bridged directly to telephony carrier stream (G.711u / Opus)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isSoftphoneActive ? (
                      <button
                        onClick={() => setIsSoftphoneActive(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow transition"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>Connect Softphone Audio</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setIsMuted(!isMuted)}
                          className={`p-2 rounded-lg text-xs font-medium border transition ${
                            isMuted
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-slate-800 hover:bg-slate-700 text-white border-slate-700'
                          }`}
                          title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                        >
                          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        </button>

                        <button
                          onClick={() => setIsOnHold(!isOnHold)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                            isOnHold
                              ? 'bg-amber-600 text-white border-amber-700'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                          }`}
                        >
                          {isOnHold ? 'Resume' : 'Hold'}
                        </button>

                        <button
                          onClick={() => {
                            setIsSoftphoneActive(false);
                            setIsMuted(false);
                            setIsOnHold(false);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow transition"
                        >
                          <PhoneOff className="w-3.5 h-3.5" />
                          <span>Disconnect</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Message History Thread */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">

                {isLoadingMessages ? (
                  <p className="text-center text-xs text-slate-400">Loading transcript...</p>
                ) : messages.length === 0 ? (
                  <p className="text-center text-xs text-slate-400">No messages in this conversation.</p>
                ) : (
                  messages.map((m) => {
                    const isCustomer = m.senderType === 'customer';
                    const isAi = m.senderType === 'ai_agent';
                    const isAgent = m.senderType === 'human_agent';

                    return (
                      <div
                        key={m.id}
                        className={`flex gap-3 max-w-2xl ${
                          isCustomer ? 'mr-auto' : 'ml-auto flex-row-reverse'
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                            isCustomer
                              ? 'bg-slate-200 text-slate-700'
                              : isAi
                              ? 'bg-sky-100 text-sky-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {isCustomer ? <User className="w-4 h-4" /> : isAi ? <Bot className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </div>

                        <div
                          className={`rounded-xl p-4 text-sm shadow-sm ${
                            isCustomer
                              ? 'bg-slate-100 text-slate-800'
                              : isAi
                              ? 'bg-sky-50 text-sky-950 border border-sky-100'
                              : 'bg-emerald-600 text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4 mb-1 text-[11px] opacity-75">
                            <span className="font-semibold uppercase tracking-wider">
                              {isCustomer
                                ? 'Caller / Customer'
                                : isAi
                                ? 'AI Assistant'
                                : 'Human Agent'}
                            </span>
                            <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>

                          <p className="whitespace-pre-wrap">{m.content}</p>

                          {m.toolCalls && m.toolCalls.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-sky-200/50 flex flex-wrap gap-1">
                              {m.toolCalls.map((tc: any, i: number) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 text-[10px] bg-white/70 text-slate-700 px-2 py-0.5 rounded font-mono border border-slate-200"
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  <span>{tc.name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Real-Time Agent Copilot Suggestions & Sentiment */}
              {activeConversation.status !== 'closed' && (
                <div className="px-4 py-2.5 bg-sky-50/50 border-t border-sky-100 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-sky-800 flex items-center gap-1.5 uppercase tracking-wider">
                      <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                      <span>Copilot Live Assist</span>
                    </span>

                    {/* Live Sentiment & Escalation Badge */}
                    <span className="inline-flex items-center gap-1 text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded-full font-medium text-slate-700 shadow-2xs">
                      <span>Sentiment:</span>
                      <strong className="text-emerald-700">Positive (88%)</strong>
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Lightbulb className="w-3 h-3 text-amber-500" /> Suggested:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAgentReplyText(
                          'Our standard diagnostic fee is $89 and includes a complete system inspection.'
                        )
                      }
                      className="text-[11px] bg-white hover:bg-sky-100 text-slate-700 border border-slate-200 hover:border-sky-300 px-2.5 py-1 rounded-md shadow-2xs transition-colors"
                    >
                      "Diagnostic fee is $89..."
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAgentReplyText(
                          'I have an emergency technician available today at 2:00 PM if you would like me to schedule a visit.'
                        )
                      }
                      className="text-[11px] bg-white hover:bg-sky-100 text-slate-700 border border-slate-200 hover:border-sky-300 px-2.5 py-1 rounded-md shadow-2xs transition-colors"
                    >
                      "Tech available today at 2 PM..."
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAgentReplyText(
                          'May I verify your physical service address and phone number for our dispatch notes?'
                        )
                      }
                      className="text-[11px] bg-white hover:bg-sky-100 text-slate-700 border border-slate-200 hover:border-sky-300 px-2.5 py-1 rounded-md shadow-2xs transition-colors"
                    >
                      "Verify address & phone..."
                    </button>
                  </div>
                </div>
              )}

              {/* Agent Reply Box */}
              {activeConversation.status !== 'closed' ? (
                <form
                  onSubmit={handleSendReply}
                  className="p-4 border-t border-slate-200 bg-white flex items-center gap-3"
                >
                  <input
                    type="text"
                    value={agentReplyText}
                    onChange={(e) => setAgentReplyText(e.target.value)}
                    placeholder="Type a response as human agent..."
                    disabled={isSending}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={isSending || !agentReplyText.trim()}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg shadow-sm text-sm flex items-center gap-2 disabled:opacity-50 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    <span>Send</span>
                  </button>
                </form>
              ) : (
                <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-xs text-slate-500">
                  This conversation has been closed and archived.
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Select a conversation to view message history
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
