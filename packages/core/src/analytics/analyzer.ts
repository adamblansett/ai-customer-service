import { AiProvider } from '../ai/provider.interface.js';
import { ConversationWithMessages, ConversationMessage } from '../conversation/types.js';


export type SentimentType = 'positive' | 'neutral' | 'negative' | 'frustrated';
export type CallResolutionStatus = 'resolved' | 'transferred' | 'callback_requested' | 'abandoned';

export interface ComplianceCheckResult {
  aiDisclosed: boolean;
  recordingConsentChecked: boolean;
  prohibitedActionsAvoided: boolean;
}

export interface ConversationAnalyticsReport {
  conversationId: string;
  tenantId: string;
  channel: string;
  durationSeconds?: number;
  sentiment: SentimentType;
  csatEstimate: number; // 1 to 5
  resolutionStatus: CallResolutionStatus;
  keyTopics: string[];
  summary: string;
  compliance: ComplianceCheckResult;
  analyzedAt: string;
}

export class ConversationAnalyzer {
  constructor(private aiProvider?: AiProvider) {}

  /**
   * Analyzes a conversation and returns structured quality and sentiment insights.
   */
  public async analyze(conv: ConversationWithMessages): Promise<ConversationAnalyticsReport> {
    const messages = conv.messages || [];
    const textAll = messages.map((m: ConversationMessage) => `${m.senderType}: ${m.content}`).join('\n');
    const lowerAll = textAll.toLowerCase();


    // 1. Compliance verification
    const aiDisclosed =
      lowerAll.includes('ai') ||
      lowerAll.includes('automated') ||
      lowerAll.includes('virtual assistant');

    const recordingConsentChecked =
      lowerAll.includes('recorded') ||
      lowerAll.includes('monitoring') ||
      lowerAll.includes('quality assurance');

    const prohibitedActionsAvoided =
      !lowerAll.includes('refund issued') &&
      !lowerAll.includes('policy overridden') &&
      !lowerAll.includes('executed command');

    // 2. Resolution status
    let resolutionStatus: CallResolutionStatus = 'resolved';
    if (conv.status === 'transferred' || lowerAll.includes('transfer you')) {
      resolutionStatus = 'transferred';
    } else if (lowerAll.includes('callback') || lowerAll.includes('call you back')) {
      resolutionStatus = 'callback_requested';
    } else if (conv.status === 'failed') {
      resolutionStatus = 'abandoned';
    }

    // 3. Sentiment & CSAT
    let sentiment: SentimentType = 'neutral';
    let csat = 4;

    const frustrationKeywords = ['angry', 'unacceptable', 'terrible', 'ridiculous', 'horrible', 'supervisor', 'sue'];
    const positiveKeywords = ['thank you', 'great', 'awesome', 'helpful', 'appreciate', 'perfect', 'excellent'];

    const hasFrustration = frustrationKeywords.some((w) => lowerAll.includes(w));
    const hasPositive = positiveKeywords.some((w) => lowerAll.includes(w));

    if (hasFrustration) {
      sentiment = 'frustrated';
      csat = 2;
    } else if (hasPositive) {
      sentiment = 'positive';
      csat = 5;
    } else if (resolutionStatus === 'abandoned') {
      sentiment = 'negative';
      csat = 2;
    }

    // 4. Topic extraction
    const topicKeywords: Record<string, string[]> = {
      hvac_repair: ['repair', 'fix', 'broken', 'not working', 'blowing cold'],
      maintenance: ['maintenance', 'tune up', 'annual check', 'inspection'],
      warranty: ['warranty', 'guarantee', 'coverage'],
      pricing: ['cost', 'price', 'fee', 'estimate', 'diagnostic'],
      hours: ['hours', 'open', 'schedule', 'weekend'],
    };

    const keyTopics: string[] = [];
    for (const [topic, words] of Object.entries(topicKeywords)) {
      if (words.some((w) => lowerAll.includes(w))) {
        keyTopics.push(topic);
      }
    }
    if (keyTopics.length === 0) {
      keyTopics.push('general_inquiry');
    }

    // 5. Executive summary
    let summary = `Customer contacted support via ${conv.channel}. Topic: ${keyTopics.join(', ')}. Resolution: ${resolutionStatus}.`;

    // If AI provider is present, generate a natural language summary
    if (this.aiProvider) {
      try {
        const aiSummary = await this.aiProvider.generate({
          messages: [
            {
              role: 'system',
              content: 'Summarize the following customer service transcript in 1 clear sentence.',
            },
            {
              role: 'user',
              content: textAll.slice(0, 2000),
            },
          ],
          maxTokens: 60,
          temperature: 0.1,
        });

        if (aiSummary.content.trim()) {
          summary = aiSummary.content.trim();
        }
      } catch {
        // Fall back to rule-based summary
      }
    }

    return {
      conversationId: conv.id,
      tenantId: conv.tenantId,
      channel: conv.channel,
      sentiment,
      csatEstimate: csat,
      resolutionStatus,
      keyTopics,
      summary,
      compliance: {
        aiDisclosed,
        recordingConsentChecked,
        prohibitedActionsAvoided,
      },
      analyzedAt: new Date().toISOString(),
    };
  }
}
