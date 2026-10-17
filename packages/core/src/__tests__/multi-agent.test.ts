import { describe, it, expect } from 'vitest';
import { MultiAgentOrchestrator } from '../ai/index.js';

describe('Multi-Agent Orchestration & Department Sub-Agents Suite', () => {
  const orchestrator = new MultiAgentOrchestrator();

  it('classifies customer inquiry to correct department sub-agent based on intent', () => {
    // 1. Billing Inquiry
    const billingAgent = orchestrator.classifyIntent(
      'Why did my credit card get charged an unexpected fee on my invoice?'
    );
    expect(billingAgent.id).toBe('billing_agent');
    expect(billingAgent.department).toBe('billing');
    expect(billingAgent.knowledgeFilterTags).toContain('pricing');

    // 2. Technical Support Inquiry
    const supportAgent = orchestrator.classifyIntent(
      'My digital thermostat is totally blank and the furnace is not working.'
    );
    expect(supportAgent.id).toBe('support_agent');
    expect(supportAgent.department).toBe('technical_support');
    expect(supportAgent.allowedTools).toContain('check_error_code');

    // 3. Scheduling & Field Dispatch Inquiry
    const dispatchAgent = orchestrator.classifyIntent(
      'Can I schedule a technician appointment for tomorrow morning? What is their ETA window?'
    );
    expect(dispatchAgent.id).toBe('dispatch_agent');
    expect(dispatchAgent.department).toBe('scheduling_dispatch');
    expect(dispatchAgent.allowedTools).toContain('book_appointment');

    // 4. Ambiguous Greeting Fallback
    const triageAgent = orchestrator.classifyIntent('Good afternoon');
    expect(triageAgent.id).toBe('general_triage');
  });

  it('executes seamless multi-turn handoffs between departments as conversation evolves', async () => {
    const session = orchestrator.initSession('tenant_acme_hvac_001', 'session_multi_001');
    expect(session.activeAgentId).toBe('general_triage');

    // Turn 1: Caller asks for appointment -> Should hand off to dispatch agent
    const turn1 = await orchestrator.routeTurn(
      session,
      'I need to book a technician appointment for my heat pump.'
    );

    expect(turn1.hasHandedOff).toBe(true);
    expect(turn1.activeAgent.id).toBe('dispatch_agent');
    expect(session.activeAgentId).toBe('dispatch_agent');
    expect(session.agentHistory).toHaveLength(2);

    // Turn 2: Follow-up question in same department -> No handoff, stay with dispatch agent
    const turn2 = await orchestrator.routeTurn(
      session,
      'Is there an afternoon window for the technician?'
    );

    expect(turn2.hasHandedOff).toBe(false);
    expect(turn2.activeAgent.id).toBe('dispatch_agent');
    expect(session.activeAgentId).toBe('dispatch_agent');

    // Turn 3: Caller pivots to billing question -> Dynamic handoff to billing specialist
    const turn3 = await orchestrator.routeTurn(
      session,
      'Before they arrive, can you check the price and invoice fee for the diagnostic?'
    );

    expect(turn3.hasHandedOff).toBe(true);
    expect(turn3.activeAgent.id).toBe('billing_agent');
    expect(turn3.handoffReason).toContain('transferred from Scheduling & Field Dispatch Specialist to Billing & Payments Specialist');
    expect(session.activeAgentId).toBe('billing_agent');
    expect(session.agentHistory).toHaveLength(3);
  });
});
