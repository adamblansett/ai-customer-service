import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import { AgentCopilot } from '../copilot/assistant.js';
import { MockAiProvider } from '../ai/mock-provider.js';

describe('Real-Time Agent Copilot & Supervisor Assist', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let tenantId: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenantId = seed.tenant1Id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('suggests real-time canned response options grounded in verified knowledge', async () => {
    const mockAi = new MockAiProvider({
      cannedResponse:
        'Our standard diagnostic fee is $89 and includes a complete system inspection. --- We have technicians available today between 2 PM and 5 PM if you would like me to schedule a visit.',
    });
    const copilot = new AgentCopilot(db, mockAi);

    const suggestions = await copilot.suggestReplies({
      tenantId,
      conversationId: 'conv_live_123',
      recentTurns: [
        { role: 'customer', content: 'How much does it cost for someone to come look at my furnace?' },
      ],
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].text).toContain('$89');
    expect(suggestions[0].confidence).toBeGreaterThan(0.7);
    expect(suggestions[1].text).toContain('schedule a visit');
  });

  it('detects live customer sentiment and raises supervisor alert on critical legal or churn triggers', () => {
    const copilot = new AgentCopilot(db);

    // Normal positive utterance
    const positiveCheck = copilot.detectLiveSentiment({
      utterance: 'Thank you so much for the quick help, I really appreciate it!',
    });
    expect(positiveCheck.sentiment).toBe('positive');
    expect(positiveCheck.shouldAlertSupervisor).toBe(false);

    // Severe frustration / legal trigger
    const criticalCheck = copilot.detectLiveSentiment({
      utterance: 'This is completely unacceptable and I demand to speak with a manager before I contact my lawyer.',
    });
    expect(criticalCheck.sentiment).toBe('frustrated');
    expect(criticalCheck.shouldAlertSupervisor).toBe(true);
    expect(criticalCheck.alertReason).toContain('lawyer');
  });

  it('automatically drafts CRM call disposition summary and extracts key topics', async () => {
    const mockAi = new MockAiProvider({
      cannedResponse: JSON.stringify({
        summary: 'Customer called regarding a noisy blower motor. Scheduled maintenance inspection for tomorrow afternoon.',
        resolutionStatus: 'resolved',
        suggestedFollowUp: 'Technician dispatch confirmed for 10/18 at 2 PM.',
        keyTopics: ['furnace', 'blower-motor', 'scheduling'],
      }),
    });
    const copilot = new AgentCopilot(db, mockAi);

    const disposition = await copilot.draftDisposition({
      messages: [
        { role: 'customer', content: 'Our blower motor is making a loud squeaking sound.' },
        { role: 'agent', content: 'I can schedule a technician to inspect the motor tomorrow at 2 PM.' },
        { role: 'customer', content: 'That works great, thank you.' },
      ],
    });

    expect(disposition.summary).toContain('noisy blower motor');
    expect(disposition.resolutionStatus).toBe('resolved');
    expect(disposition.keyTopics).toContain('blower-motor');
  });
});
