'use client';

import React, { useState } from 'react';
import {
  GitFork,
  Play,
  Plus,
  Save,
  PhoneCall,
  Clock,
  Mic,
  MessageSquare,
  Users,
  Voicemail,
  PhoneOff,
  CheckCircle2,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

interface VisualNode {
  id: string;
  type: 'greeting' | 'dtmf_menu' | 'ai_voice' | 'hours_check' | 'transfer_queue' | 'voicemail_callback' | 'hangup';
  title: string;
  description: string;
  branches?: Array<{ label: string; targetId: string }>;
  nextId?: string;
}

const INITIAL_NODES: VisualNode[] = [
  {
    id: 'node_welcome',
    type: 'greeting',
    title: 'Welcome Greeting',
    description: 'Thank you for calling Acme Heating and Cooling.',
    nextId: 'node_menu',
  },
  {
    id: 'node_menu',
    type: 'dtmf_menu',
    title: 'Main Department Menu',
    description: 'Press 1 for Sales, Press 2 for Emergency, or stay on the line for AI Assistant.',
    branches: [
      { label: 'Key 1 (Sales)', targetId: 'node_sales' },
      { label: 'Key 2 (Emergency)', targetId: 'node_hours' },
      { label: 'Default / Speech', targetId: 'node_ai' },
    ],
  },
  {
    id: 'node_sales',
    type: 'transfer_queue',
    title: 'Sales Queue',
    description: 'Transfers call to residential and commercial sales team.',
  },
  {
    id: 'node_hours',
    type: 'hours_check',
    title: 'Operating Hours Check',
    description: 'Checks if current time in America/New_York is within 08:00 - 21:00.',
    branches: [
      { label: 'Open (Daytime)', targetId: 'node_dispatch' },
      { label: 'Closed (Nighttime)', targetId: 'node_callback' },
    ],
  },
  {
    id: 'node_dispatch',
    type: 'transfer_queue',
    title: 'Emergency Dispatch',
    description: 'Transfers to on-call emergency technician ring group.',
  },
  {
    id: 'node_callback',
    type: 'voicemail_callback',
    title: 'Emergency Voicemail & Callback',
    description: 'Collects address and schedules immediate next-morning dispatch ticket.',
  },
  {
    id: 'node_ai',
    type: 'ai_voice',
    title: 'AI Conversational Assistant',
    description: 'Grounded RAG assistance answering HVAC questions and troubleshooting.',
    nextId: 'node_hangup',
  },
  {
    id: 'node_hangup',
    type: 'hangup',
    title: 'Friendly Hangup',
    description: 'Thank you for calling Acme. Have a great day!',
  },
];

export default function CallFlowsPage() {
  const [nodes, setNodes] = useState<VisualNode[]>(INITIAL_NODES);
  const [selectedNode, setSelectedNode] = useState<VisualNode | null>(INITIAL_NODES[0]);
  const [simulationLog, setSimulationLog] = useState<string[]>([
    'Flow initialized at [Welcome Greeting].',
    'Spoke: "Thank you for calling Acme Heating and Cooling."',
    'Advanced to [Main Department Menu].',
  ]);
  const [simStep, setSimStep] = useState<number>(1);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const getNodeIcon = (type: VisualNode['type']) => {
    switch (type) {
      case 'greeting':
        return <PhoneCall className="w-5 h-5 text-blue-500" />;
      case 'dtmf_menu':
        return <GitFork className="w-5 h-5 text-purple-500" />;
      case 'ai_voice':
        return <Sparkles className="w-5 h-5 text-amber-500" />;
      case 'hours_check':
        return <Clock className="w-5 h-5 text-indigo-500" />;
      case 'transfer_queue':
        return <Users className="w-5 h-5 text-emerald-500" />;
      case 'voicemail_callback':
        return <Voicemail className="w-5 h-5 text-orange-500" />;
      case 'hangup':
        return <PhoneOff className="w-5 h-5 text-zinc-500" />;
      default:
        return <MessageSquare className="w-5 h-5 text-zinc-400" />;
    }
  };

  const handleSimulateKey = (key: string) => {
    if (key === '1') {
      setSimulationLog((prev) => [
        ...prev,
        'Caller pressed [1]',
        'Branch matched: Key 1 (Sales)',
        'Action: <Dial> Transferring to Sales Queue.',
        '✓ Call completed successfully.',
      ]);
    } else if (key === '2') {
      setSimulationLog((prev) => [
        ...prev,
        'Caller pressed [2]',
        'Branch matched: Key 2 (Emergency)',
        'Evaluating Business Hours in America/New_York...',
        'Result: Open (Daytime) -> Routed to Emergency Dispatch Queue.',
        '✓ Call completed successfully.',
      ]);
    } else {
      setSimulationLog((prev) => [
        ...prev,
        'No DTMF pressed -> Speech Detected: "I need help with my thermostat"',
        'Branch matched: Default / Speech -> Routed to AI Assistant.',
        'AI Spoke: "I would be happy to guide you through thermostat troubleshooting."',
      ]);
    }
    setSimStep((s) => s + 1);
  };

  const handleSave = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Interactive Call Flow & IVR Builder
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Design, simulate, and deploy visual call routing trees, voice menus, and AI assistant handoffs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedSuccess && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-400 px-3 py-1.5 rounded-md border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4" /> Published Flow Active
            </span>
          )}
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
          >
            <Save className="w-4 h-4" /> Save & Deploy
          </button>
        </div>
      </div>

      {/* Main Builder Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visual Node Flow View */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300 rounded-md">
                Production Flow v1.2
              </span>
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Assigned to: <strong className="text-zinc-900 dark:text-zinc-100">+1 (800) 555-0199</strong>
              </span>
            </div>
            <span className="text-xs text-zinc-400">{nodes.length} Nodes Configured</span>
          </div>

          <div className="space-y-3">
            {nodes.map((node, idx) => {
              const isSelected = selectedNode?.id === node.id;
              return (
                <div key={node.id} className="relative">
                  <div
                    onClick={() => setSelectedNode(node)}
                    className={`cursor-pointer bg-white dark:bg-zinc-900 border rounded-xl p-4 transition-all shadow-sm ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500/20'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 mt-0.5">
                          {getNodeIcon(node.type)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-zinc-400">Step {idx + 1}</span>
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {node.title}
                            </h3>
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            {node.description}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-400" />
                    </div>

                    {/* Branches preview */}
                    {node.branches && (
                      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-2">
                        {node.branches.map((b, bIdx) => (
                          <span
                            key={bIdx}
                            className="inline-flex items-center text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded"
                          >
                            ↳ {b.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inspector & Flow Simulator Drawer */}
        <div className="space-y-6">
          {/* Node Inspector */}
          {selectedNode && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                {getNodeIcon(selectedNode.type)}
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Node Inspector
                  </h3>
                  <p className="text-xs text-zinc-400">ID: {selectedNode.id}</p>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-zinc-400 font-medium">Node Type</label>
                  <p className="font-semibold text-zinc-800 dark:text-zinc-200 mt-0.5 uppercase tracking-wide">
                    {selectedNode.type.replace('_', ' ')}
                  </p>
                </div>
                <div>
                  <label className="text-zinc-400 font-medium">Title</label>
                  <input
                    type="text"
                    value={selectedNode.title}
                    readOnly
                    className="w-full mt-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="text-zinc-400 font-medium">Instructions / Prompt</label>
                  <textarea
                    rows={3}
                    value={selectedNode.description}
                    readOnly
                    className="w-full mt-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md p-2 text-xs text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Interactive Flow Simulator */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-emerald-500" />
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Live Flow Simulator
                </h3>
              </div>
              <button
                onClick={() => {
                  setSimulationLog([
                    'Flow initialized at [Welcome Greeting].',
                    'Spoke: "Thank you for calling Acme Heating and Cooling."',
                    'Advanced to [Main Department Menu].',
                  ]);
                  setSimStep(1);
                }}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Reset
              </button>
            </div>

            {/* Simulated Keypad Controls */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-400">Caller Action / Keypad Input</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleSimulateKey('1')}
                  className="py-2 text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Press 1 (Sales)
                </button>
                <button
                  onClick={() => handleSimulateKey('2')}
                  className="py-2 text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Press 2 (Emergency)
                </button>
                <button
                  onClick={() => handleSimulateKey('speech')}
                  className="py-2 text-xs font-semibold bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  Speak to AI
                </button>
              </div>
            </div>

            {/* Simulation Execution Trace */}
            <div className="space-y-1 bg-zinc-950 rounded-lg p-3 text-[11px] font-mono text-zinc-300 max-h-48 overflow-y-auto">
              {simulationLog.map((log, lIdx) => (
                <div key={lIdx} className="leading-relaxed">
                  {log.startsWith('✓') ? (
                    <span className="text-emerald-400">{log}</span>
                  ) : log.startsWith('Caller') ? (
                    <span className="text-amber-400 font-semibold">{log}</span>
                  ) : (
                    <span>{log}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
