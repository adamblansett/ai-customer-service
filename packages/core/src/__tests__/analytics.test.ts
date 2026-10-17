import { describe, it, expect } from 'vitest';
import { ConversationAnalyzer } from '../analytics/analyzer.js';
import { ConversationWithMessages } from '../conversation/types.js';
import { MockAiProvider } from '../ai/mock-provider.js';

describe('AI Post-Call Analytics & Conversation Insights', () => {
  it('analyzes positive customer conversation with compliance checks', async () => {
    const analyzer = new ConversationAnalyzer();

    const conv: ConversationWithMessages = {
      id: 'conv_pos_001',
      tenantId: 'tenant_acme',
      channel: 'voice',
      status: 'closed',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      messages: [
        {
          id: 'm1',
          conversationId: 'conv_pos_001',
          tenantId: 'tenant_acme',
          senderType: 'ai_agent',
          content: 'Thank you for calling Acme. I am an AI assistant. This call is recorded for quality assurance. How can I help?',
          createdAt: new Date(),
        },
        {
          id: 'm2',
          conversationId: 'conv_pos_001',
          tenantId: 'tenant_acme',
          senderType: 'customer',
          content: 'What is your warranty policy on heat pumps?',
          createdAt: new Date(),
        },
        {
          id: 'm3',
          conversationId: 'conv_pos_001',
          tenantId: 'tenant_acme',
          senderType: 'ai_agent',
          content: 'Our heat pump warranty covers parts for 5 years.',
          createdAt: new Date(),
        },
        {
          id: 'm4',
          conversationId: 'conv_pos_001',
          tenantId: 'tenant_acme',
          senderType: 'customer',
          content: 'Thank you so much, that was very helpful and great service!',
          createdAt: new Date(),
        },
      ],
    };

    const report = await analyzer.analyze(conv);

    expect(report.sentiment).toBe('positive');
    expect(report.csatEstimate).toBe(5);
    expect(report.resolutionStatus).toBe('resolved');
    expect(report.keyTopics).toContain('warranty');
    expect(report.compliance.aiDisclosed).toBe(true);
    expect(report.compliance.recordingConsentChecked).toBe(true);
    expect(report.compliance.prohibitedActionsAvoided).toBe(true);
  });

  it('detects frustrated caller and human transfer escalation', async () => {
    const analyzer = new ConversationAnalyzer();

    const conv: ConversationWithMessages = {
      id: 'conv_frust_002',
      tenantId: 'tenant_acme',
      channel: 'voice',
      status: 'transferred',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      messages: [
        {
          id: 'm1',
          conversationId: 'conv_frust_002',
          tenantId: 'tenant_acme',
          senderType: 'customer',
          content: 'This is terrible! My heater is completely broken in freezing weather. Get me a supervisor immediately!',
          createdAt: new Date(),
        },
        {
          id: 'm2',
          conversationId: 'conv_frust_002',
          tenantId: 'tenant_acme',
          senderType: 'ai_agent',
          content: 'I understand this is an emergency. I will transfer you to a human technician right away.',
          createdAt: new Date(),
        },
      ],
    };

    const report = await analyzer.analyze(conv);

    expect(report.sentiment).toBe('frustrated');
    expect(report.csatEstimate).toBe(2);
    expect(report.resolutionStatus).toBe('transferred');
    expect(report.keyTopics).toContain('hvac_repair');
  });

  it('generates natural language summary using AiProvider', async () => {
    const mockAi = new MockAiProvider({
      cannedResponse: 'Customer inquired about heat pump warranty terms and received policy details.',
    });
    const analyzer = new ConversationAnalyzer(mockAi);

    const conv: ConversationWithMessages = {
      id: 'conv_ai_summary',
      tenantId: 'tenant_acme',
      channel: 'chat',
      status: 'closed',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      messages: [
        {
          id: 'm1',
          conversationId: 'conv_ai_summary',
          tenantId: 'tenant_acme',
          senderType: 'customer',
          content: 'Tell me about heat pump warranties.',
          createdAt: new Date(),
        },
      ],
    };

    const report = await analyzer.analyze(conv);
    expect(report.summary).toBe('Customer inquired about heat pump warranty terms and received policy details.');
  });
});
