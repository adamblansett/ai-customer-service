import { describe, it, expect } from 'vitest';
import { FlowEngine, type CallFlowGraph } from '../flows/index.js';

describe('Visual Call Flow & IVR Engine Suite', () => {
  const sampleGraph: CallFlowGraph = {
    id: 'flow_hvac_main_001',
    tenantId: 'tenant_acme_hvac_001',
    name: 'Main Company IVR & AI Assistant Flow',
    startNodeId: 'node_welcome',
    version: 1,
    published: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: 'node_welcome',
        type: 'greeting',
        title: 'Initial Welcome Greeting',
        config: { message: 'Thank you for calling Acme Heating and Cooling.' },
        next: 'node_menu',
      },
      {
        id: 'node_menu',
        type: 'dtmf_menu',
        title: 'Main Department Menu',
        config: {
          prompt: 'Press 1 for Sales, Press 2 for Emergency Repairs, or stay on the line for our AI Assistant.',
          options: { '1': 'Sales', '2': 'Repairs' },
        },
        next: 'node_ai_agent',
        branches: [
          { condition: '1', targetNodeId: 'node_sales_queue' },
          { condition: '2', targetNodeId: 'node_emergency_check' },
        ],
      },
      {
        id: 'node_sales_queue',
        type: 'transfer_queue',
        title: 'Sales Queue Transfer',
        config: { queueName: 'sales', announcement: 'Connecting to commercial and residential sales.' },
      },
      {
        id: 'node_emergency_check',
        type: 'hours_check',
        title: 'After-Hours Check for Emergency Calls',
        config: { timezone: 'America/New_York' },
        branches: [
          { condition: 'open', targetNodeId: 'node_dispatch_queue' },
          { condition: 'closed', targetNodeId: 'node_after_hours_callback' },
        ],
      },
      {
        id: 'node_dispatch_queue',
        type: 'transfer_queue',
        title: 'Emergency Dispatch Queue',
        config: { queueName: 'emergency_dispatch' },
      },
      {
        id: 'node_after_hours_callback',
        type: 'voicemail_callback',
        title: 'After Hours Callback Request',
        config: { message: 'Our office is currently closed. We have queued a high-priority emergency callback.' },
      },
      {
        id: 'node_ai_agent',
        type: 'ai_voice',
        title: 'AI Conversational Assistant',
        config: { prompt: 'How can I assist you with your heating or cooling system today?' },
        next: 'node_hangup',
      },
      {
        id: 'node_hangup',
        type: 'hangup',
        title: 'End of Call',
        config: { message: 'Thank you for calling Acme. Have a great day.' },
      },
    ],
  };

  it('initializes execution and delivers initial greeting step', () => {
    const state = FlowEngine.initExecution(sampleGraph);
    expect(state.currentNodeId).toBe('node_welcome');
    expect(state.isComplete).toBe(false);

    const step1 = FlowEngine.executeStep(sampleGraph, state);
    expect(step1.nodeType).toBe('greeting');
    expect(step1.action).toBe('say');
    expect(step1.promptText).toBe('Thank you for calling Acme Heating and Cooling.');
    expect(state.currentNodeId).toBe('node_menu'); // Advanced to next node
  });

  it('prompts DTMF menu and branches based on caller keypad digit press', () => {
    const state = FlowEngine.initExecution(sampleGraph);
    FlowEngine.executeStep(sampleGraph, state); // advances from welcome to menu

    // 1. Gather DTMF prompt
    const menuPrompt = FlowEngine.executeStep(sampleGraph, state);
    expect(menuPrompt.nodeType).toBe('dtmf_menu');
    expect(menuPrompt.action).toBe('gather_dtmf');
    expect(menuPrompt.dtmfOptions?.['1']).toBe('Sales');

    // 2. Caller presses '1' (Sales)
    const salesStep = FlowEngine.executeStep(sampleGraph, state, { digits: '1' });
    expect(salesStep.nodeType).toBe('transfer_queue');
    expect(salesStep.action).toBe('dial');
    expect(salesStep.target).toBe('sales');
    expect(salesStep.state.isComplete).toBe(true);
  });

  it('evaluates business hours check node and routes accordingly', () => {
    const state = FlowEngine.initExecution(sampleGraph);
    state.currentNodeId = 'node_emergency_check';

    // Test during daytime (14:00 EDT) -> routes to dispatch queue
    const daytime = new Date('2026-10-15T18:00:00.000Z');
    const dayResult = FlowEngine.executeStep(sampleGraph, state, undefined, daytime);
    expect(dayResult.nodeType).toBe('transfer_queue');
    expect(dayResult.target).toBe('emergency_dispatch');

    // Test during late night (03:00 EDT) -> routes to after hours callback
    const stateNight = FlowEngine.initExecution(sampleGraph);
    stateNight.currentNodeId = 'node_emergency_check';
    const nighttime = new Date('2026-10-15T07:00:00.000Z');
    const nightResult = FlowEngine.executeStep(sampleGraph, stateNight, undefined, nighttime);
    expect(nightResult.nodeType).toBe('voicemail_callback');
    expect(nightResult.promptText).toContain('emergency callback');
  });

  it('routes to AI conversational assistant when no menu digits are pressed', () => {
    const state = FlowEngine.initExecution(sampleGraph);
    FlowEngine.executeStep(sampleGraph, state); // Welcome
    FlowEngine.executeStep(sampleGraph, state); // Menu prompt

    // Caller says nothing or presses nothing -> advances to default next (node_ai_agent)
    const aiStep = FlowEngine.executeStep(sampleGraph, state, { speech: 'I have a question about filters' });
    expect(aiStep.nodeType).toBe('ai_voice');
    expect(aiStep.action).toBe('gather_speech');
  });
});
