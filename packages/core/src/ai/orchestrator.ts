import type { AiProvider } from './provider.interface.js';

export interface DepartmentAgent {
  id: string;
  name: string;
  department: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  knowledgeFilterTags?: string[];
  intentKeywords: string[];
}

export interface MultiAgentSession {
  sessionId: string;
  tenantId: string;
  activeAgentId: string;
  agentHistory: Array<{
    agentId: string;
    department: string;
    startedAt: string;
    turnCount: number;
  }>;
  variables: Record<string, any>;
}

export interface MultiAgentTurnResult {
  activeAgent: DepartmentAgent;
  hasHandedOff: boolean;
  handoffReason?: string;
  replyContent: string;
}

export class MultiAgentOrchestrator {
  private agents: Map<string, DepartmentAgent> = new Map();
  private defaultAgentId: string = 'general_triage';
  private aiProvider?: AiProvider;

  constructor(aiProvider?: AiProvider) {
    this.aiProvider = aiProvider;
    this.registerDefaultAgents();
  }

  private registerDefaultAgents(): void {
    this.registerAgent({
      id: 'general_triage',
      name: 'Triage & Inception Agent',
      department: 'general',
      description: 'Initial customer greeting and routing.',
      systemPrompt: 'You are the customer service receptionist. Greet customers warmly and identify their inquiry.',
      allowedTools: ['lookup_customer', 'route_department'],
      intentKeywords: ['hello', 'hi', 'help', 'representative', 'question'],
    });

    this.registerAgent({
      id: 'billing_agent',
      name: 'Billing & Payments Specialist',
      department: 'billing',
      description: 'Invoices, payments, credit card receipts, and refund inquiries.',
      systemPrompt: 'You are the billing specialist. Help with invoice balances, payment dates, and diagnostic fee explanations.',
      allowedTools: ['check_balance', 'lookup_invoice'],
      knowledgeFilterTags: ['billing', 'pricing', 'warranty'],
      intentKeywords: ['bill', 'invoice', 'charge', 'cost', 'fee', 'price', 'payment', 'refund', 'receipt', 'card'],
    });

    this.registerAgent({
      id: 'support_agent',
      name: 'Technical Troubleshooting Specialist',
      department: 'technical_support',
      description: 'HVAC equipment errors, thermostat diagnostics, and emergency repair guidance.',
      systemPrompt: 'You are a certified HVAC technical assistant. Guide callers through safe, approved diagnostic steps.',
      allowedTools: ['lookup_manual', 'check_error_code'],
      knowledgeFilterTags: ['troubleshooting', 'error-codes', 'maintenance'],
      intentKeywords: ['broken', 'not working', 'blowing warm', 'blank display', 'thermostat', 'leak', 'furnace', 'ac', 'noise', 'frozen'],
    });

    this.registerAgent({
      id: 'dispatch_agent',
      name: 'Scheduling & Field Dispatch Specialist',
      department: 'scheduling_dispatch',
      description: 'Technician appointments, arrival windows, and emergency service calls.',
      systemPrompt: 'You are the scheduling assistant. Help callers book technician appointments and check arrival windows.',
      allowedTools: ['check_availability', 'book_appointment', 'check_technician_eta'],
      knowledgeFilterTags: ['scheduling', 'coverage-area', 'hours'],
      intentKeywords: ['appointment', 'schedule', 'book', 'technician', 'arrive', 'eta', 'window', 'calendar', 'visit'],
    });
  }

  public registerAgent(agent: DepartmentAgent): void {
    this.agents.set(agent.id, agent);
  }

  public getAgent(agentId: string): DepartmentAgent | undefined {
    return this.agents.get(agentId);
  }

  public listAgents(): DepartmentAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Evaluates text and classifies optimal department agent based on intent keywords and entity signals.
   */
  public classifyIntent(message: string): DepartmentAgent {
    const lower = message.toLowerCase();

    // Check specialized departments first
    const candidates = Array.from(this.agents.values()).filter(
      (a) => a.id !== this.defaultAgentId
    );

    let bestAgent = this.agents.get(this.defaultAgentId)!;
    let maxMatches = 0;

    for (const agent of candidates) {
      let matches = 0;
      for (const keyword of agent.intentKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(lower)) {
          matches++;
        }
      }

      if (matches > maxMatches) {
        maxMatches = matches;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }

  public initSession(tenantId: string, sessionId: string): MultiAgentSession {
    return {
      sessionId,
      tenantId,
      activeAgentId: this.defaultAgentId,
      agentHistory: [
        {
          agentId: this.defaultAgentId,
          department: 'general',
          startedAt: new Date().toISOString(),
          turnCount: 0,
        },
      ],
      variables: {},
    };
  }

  /**
   * Processes a customer conversational turn, detecting cross-department handoffs if intent changes.
   */
  public async routeTurn(
    session: MultiAgentSession,
    customerMessage: string
  ): Promise<MultiAgentTurnResult> {
    const detectedAgent = this.classifyIntent(customerMessage);
    let hasHandedOff = false;
    let handoffReason: string | undefined;

    // Trigger handoff if intent maps to a different specialized agent
    if (
      detectedAgent.id !== this.defaultAgentId &&
      detectedAgent.id !== session.activeAgentId
    ) {
      const priorAgent = this.agents.get(session.activeAgentId);
      hasHandedOff = true;
      handoffReason = `Inquiry transferred from ${priorAgent?.name || session.activeAgentId} to ${detectedAgent.name} based on customer intent.`;

      session.activeAgentId = detectedAgent.id;
      session.agentHistory.push({
        agentId: detectedAgent.id,
        department: detectedAgent.department,
        startedAt: new Date().toISOString(),
        turnCount: 1,
      });
    } else {
      const currentHistory = session.agentHistory[session.agentHistory.length - 1];
      if (currentHistory) {
        currentHistory.turnCount++;
      }
    }

    const currentAgent = this.agents.get(session.activeAgentId) || detectedAgent;

    let replyContent: string;
    if (this.aiProvider) {
      const completion = await this.aiProvider.generate({
        messages: [
          { role: 'system', content: currentAgent.systemPrompt },
          { role: 'user', content: customerMessage },
        ],
      });
      replyContent = completion.content;
    } else {
      // Deterministic fallback response when running offline or in unit tests
      if (hasHandedOff) {
        replyContent = `I am connecting you with our ${currentAgent.name}. How can we resolve your ${currentAgent.department} request?`;
      } else {
        replyContent = `[${currentAgent.name}]: Thank you for your question. I am assisting with your inquiry.`;
      }
    }

    return {
      activeAgent: currentAgent,
      hasHandedOff,
      handoffReason,
      replyContent,
    };
  }
}
