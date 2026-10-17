'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  BookOpen,
  Plus,
  Trash2,
  Search,
  FileText,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Layers,
} from 'lucide-react';

interface KnowledgeDoc {
  id: string;
  title: string;
  sourceUri?: string;
  chunkCount: number;
  status: string;
  createdAt: string;
}

interface SearchResult {
  chunkId: string;
  documentTitle: string;
  sourceUri?: string;
  content: string;
  score: number;
  confidence: string;
}

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isIngesting, setIsIngesting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Ingest form state
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docUri, setDocUri] = useState('');

  // Interactive Test Search state
  const [testQuery, setTestQuery] = useState('');
  const [testResults, setTestResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const tenantId = typeof window !== 'undefined'
    ? localStorage.getItem('active_tenant_id') || 'tenant_acme_hvac_001'
    : 'tenant_acme_hvac_001';

  const fetchDocuments = async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch<{ documents: KnowledgeDoc[] }>(`/tenants/${tenantId}/knowledge`);
      setDocuments(data.documents || []);
    } catch {
      // Error
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim() || !docContent.trim()) return;

    setIsIngesting(true);
    try {
      await apiFetch(`/tenants/${tenantId}/knowledge`, {
        method: 'POST',
        body: JSON.stringify({
          title: docTitle.trim(),
          rawContent: docContent.trim(),
          sourceUri: docUri.trim() || undefined,
        }),
      });

      setShowAddModal(false);
      setDocTitle('');
      setDocContent('');
      setDocUri('');
      fetchDocuments();
    } catch (err: any) {
      alert(err.message || 'Failed to ingest document');
    } finally {
      setIsIngesting(false);
    }
  };

  const handleDelete = async (docId: string, title: string) => {
    if (!confirm(`Delete knowledge document "${title}" and all its indexed chunks?`)) return;

    try {
      await apiFetch(`/tenants/${tenantId}/knowledge/${docId}`, {
        method: 'DELETE',
      });
      fetchDocuments();
      if (testResults) setTestResults(null);
    } catch (err: any) {
      alert(err.message || 'Failed to delete document');
    }
  };

  const handleTestSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim()) return;

    setIsSearching(true);
    try {
      const data = await apiFetch<{ query: string; results: SearchResult[] }>(
        `/tenants/${tenantId}/knowledge/test-search`,
        {
          method: 'POST',
          body: JSON.stringify({ query: testQuery.trim() }),
        }
      );
      setTestResults(data.results || []);
    } catch (err: any) {
      alert(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Business Knowledge Base</h1>
          <p className="text-sm text-slate-500">
            Approved business documents, policies, and pricing with automatic semantic chunking
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg shadow-sm text-sm transition-colors self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add Knowledge Document</span>
        </button>
      </div>

      {/* Interactive Search Tester */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Search className="w-5 h-5 text-sky-600" />
          <h2 className="text-base font-bold text-slate-900">Knowledge Search & Retrieval Tester</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Test what the AI agent will retrieve when callers ask questions. Validates relevance scoring and source attribution.
        </p>

        <form onSubmit={handleTestSearch} className="flex gap-3">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            placeholder="e.g. How much does a furnace maintenance tuneup cost?"
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
          <button
            type="submit"
            disabled={isSearching || !testQuery.trim()}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSearching ? 'Searching...' : 'Test Query'}
          </button>
        </form>

        {testResults && (
          <div className="mt-6 pt-6 border-t border-slate-100 space-y-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Search Results ({testResults.length} matches):
            </h3>

            {testResults.length === 0 ? (
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Unverified Knowledge / No Relevant Matches</p>
                  <p className="text-xs mt-1">
                    The query confidence was below the relevance threshold. The AI agent will safely decline to answer or offer human transfer to prevent hallucinations.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {testResults.map((r, i) => (
                  <div key={i} className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-slate-900">{r.documentTitle}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Score: {Math.round(r.score * 100)}%</span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            r.confidence === 'high'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {r.confidence} confidence
                        </span>
                      </div>
                    </div>
                    <p className="text-slate-700 whitespace-pre-wrap">{r.content}</p>
                    {r.sourceUri && (
                      <span className="text-[11px] font-mono text-slate-400 mt-2 block">
                        Source: {r.sourceUri}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Documents List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">Approved Business Documents ({documents.length})</h2>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {isLoading && documents.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-400">Loading documents...</p>
          ) : documents.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No knowledge documents indexed yet.</p>
              <p className="text-xs mt-1">Upload a markdown or FAQ document to enable AI question answering.</p>
            </div>
          ) : (
            documents.map((doc) => (
              <div key={doc.id} className="p-6 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">{doc.title}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                      <Layers className="w-3 h-3" />
                      <span>{doc.chunkCount} chunks</span>
                    </span>
                    <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-medium">
                      {doc.status}
                    </span>
                  </div>
                  {doc.sourceUri && (
                    <p className="text-xs text-slate-400 font-mono">Source: {doc.sourceUri}</p>
                  )}
                  <p className="text-xs text-slate-400">
                    Added: {new Date(doc.createdAt).toLocaleDateString()}
                  </p>
                </div>

                <button
                  onClick={() => handleDelete(doc.id, doc.title)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Delete Document"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Document Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Add Knowledge Document</h2>
            <p className="text-xs text-slate-500 mb-5">
              Paste FAQ content, pricing lists, or business policy in Markdown format.
            </p>

            <form onSubmit={handleIngest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Document Title
                </label>
                <input
                  type="text"
                  required
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="e.g. Cancellation and Refund Policy"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Source Reference (Optional URI)
                </label>
                <input
                  type="text"
                  value={docUri}
                  onChange={(e) => setDocUri(e.target.value)}
                  placeholder="e.g. kb://policies/cancellation.md"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Content (Markdown or Plain Text)
                </label>
                <textarea
                  required
                  rows={8}
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  placeholder="# Cancellation Policy&#10;Appointments cancelled with at least 24 hours notice are eligible for full rescheduling without penalty."
                  className="w-full p-3.5 rounded-lg border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isIngesting || !docTitle.trim() || !docContent.trim()}
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg text-sm shadow-sm transition-colors disabled:opacity-50"
                >
                  {isIngesting ? 'Ingesting...' : 'Ingest & Index'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
