import type { DatabaseInstance } from '@customer-service/db';
import * as schema from '@customer-service/db/schema';
import { eq } from 'drizzle-orm';
import { AiProvider } from '../ai/provider.interface.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import { KnowledgeRetriever } from '../knowledge/retriever.js';
import { wrapUntrustedContext } from '../safety/injection-defense.js';

export interface CopilotSuggestion {
  text: string;
  confidence: number;
  sourceTitle?: string;
}

export interface LiveSentimentAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  intensity: number; // 0.0 to 1.0
  shouldAlertSupervisor: boolean;
  alertReason?: string;
}

export interface CallDispositionDraft {
  summary: string;
  resolutionStatus: 'resolved' | 'follow_up_needed' | 'escalated';
  suggestedFollowUp?: string;
  keyTopics: string[];
}

const SUPERVISOR_ESCALATION_KEYWORDS = [
  'lawyer',
  'attorney',
  'sue',
  'lawsuit',
  'bbb',
  'better business bureau',
  'unacceptable',
  'scam',
  'rip off',
  'speak with a manager',
  'demand to speak',
  'cancel my account',
];

export class AgentCopilot {
  private db: DatabaseInstance;
  private aiProvider: AiProvider;
  private retriever: KnowledgeRetriever;

  constructor(
    db: DatabaseInstance,
    aiProvider: AiProvider = new MockAiProvider(),
    retriever?: KnowledgeRetriever
  ) {
    this.db = db;
    this.aiProvider = aiProvider;
    this.retriever = retriever || new KnowledgeRetriever(db);
  }

  /**
   * Generates real-time suggested responses for a human agent based on recent conversation turns and knowledge retrieval.
   */
  public async suggestReplies(params: {
    tenantId: string;
    conversationId: string;
    recentTurns: Array<{ role: string; content: string }>;
  }): Promise<CopilotSuggestion[]> {
    const lastUserTurn = [...params.recentTurns].reverse().find((t) => t.role === 'customer' || t.role === 'user');
    const query = lastUserTurn ? lastUserTurn.content : '';

    if (!query) {
      return [
        { text: 'How can I assist you today?', confidence: 0.9 },
        { text: 'Could you please provide your account number or address?', confidence: 0.85 },
      ];
    }

    // Retrieve verified knowledge chunks
    const chunks = await this.retriever.search(params.tenantId, query, { limit: 2 });
    let contextSnippet = '';
    let topSourceTitle: string | undefined;

    if (chunks.length > 0) {
      topSourceTitle = chunks[0].documentTitle;
      contextSnippet = chunks.map((c) => `[Source: ${c.documentTitle}]\n${c.content}`).join('\n\n');
    }

    const safeContext = wrapUntrustedContext('knowledge', contextSnippet || 'No additional documents.');

    const prompt =
      `You are an AI Agent Copilot assisting a human customer service representative in real time.\n` +
      `Generate 2 distinct, highly relevant, and professional response suggestions for the agent to say to the customer.\n` +
      `Each suggestion must be concise (1-2 sentences) and grounded strictly in the verified knowledge below.\n\n` +
      `VERIFIED KNOWLEDGE:\n${safeContext}\n\n` +
      `CUSTOMER UTTERANCE:\n"${query}"\n\n` +
      `Output ONLY the two suggestions separated by the delimiter "---".`;

    const aiRes = await this.aiProvider.generate({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens: 180,
    });

    const suggestions = (aiRes.content || '')
      .split('---')
      .map((s) => s.trim().replace(/^[\d.)\s\-]+/, ''))
      .filter((s) => s.length > 5);

    if (suggestions.length === 0) {
      return [
        {
          text: `I'd be glad to look into that for you. May I verify your service address?`,
          confidence: 0.8,
          sourceTitle: topSourceTitle,
        },
      ];
    }

    return suggestions.map((text, idx) => ({
      text,
      confidence: Math.max(0.7, 0.95 - idx * 0.1),
      sourceTitle: topSourceTitle,
    }));
  }

  /**
   * Performs real-time sentiment analysis on an utterance and flags supervisor escalation triggers.
   */
  public detectLiveSentiment(params: {
    utterance: string;
    previousSentiment?: string;
  }): LiveSentimentAnalysis {
    const text = (params.utterance || '').toLowerCase();

    // Check for supervisor escalation triggers
    for (const kw of SUPERVISOR_ESCALATION_KEYWORDS) {
      if (text.includes(kw)) {
        return {
          sentiment: 'frustrated',
          intensity: 0.95,
          shouldAlertSupervisor: true,
          alertReason: `Caller mentioned critical trigger phrase: "${kw}"`,
        };
      }
    }

    // Heuristic sentiment scoring
    const frustratedWords = ['angry', 'furious', 'horrible', 'terrible', 'ridiculous', 'useless', 'garbage', 'broken'];
    const negativeWords = ['disappointed', 'unhappy', 'slow', 'confused', 'delay', 'issue', 'problem', 'leak'];
    const positiveWords = ['thank', 'great', 'awesome', 'excellent', 'helpful', 'appreciate', 'perfect', 'solved'];

    const hasFrustrated = frustratedWords.some((w) => text.includes(w));
    if (hasFrustrated) {
      return {
        sentiment: 'frustrated',
        intensity: 0.85,
        shouldAlertSupervisor: true,
        alertReason: 'High customer frustration detected.',
      };
    }

    const hasNegative = negativeWords.some((w) => text.includes(w));
    if (hasNegative) {
      return {
        sentiment: 'negative',
        intensity: 0.65,
        shouldAlertSupervisor: false,
      };
    }

    const hasPositive = positiveWords.some((w) => text.includes(w));
    if (hasPositive) {
      return {
        sentiment: 'positive',
        intensity: 0.8,
        shouldAlertSupervisor: false,
      };
    }

    return {
      sentiment: 'neutral',
      intensity: 0.5,
      shouldAlertSupervisor: false,
    };
  }

  /**
   * Automatically drafts call disposition notes and summaries for CRM tickets.
   */
  public async draftDisposition(params: {
    messages: Array<{ role: string; content: string }>;
  }): Promise<CallDispositionDraft> {
    if (params.messages.length === 0) {
      return {
        summary: 'Call connected with no conversational turns recorded.',
        resolutionStatus: 'resolved',
        keyTopics: ['general-inquiry'],
      };
    }

    const transcript = params.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const prompt =
      `Summarize the following customer service conversation for CRM ticket disposition.\n` +
      `Identify: (1) Brief 2-sentence summary, (2) Resolution status (resolved, follow_up_needed, or escalated), and (3) Key topics.\n\n` +
      `TRANSCRIPT:\n${transcript}\n\n` +
      `Format your output as JSON with keys: "summary", "resolutionStatus", "suggestedFollowUp", "keyTopics" (array of strings).`;

    const aiRes = await this.aiProvider.generate({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 250,
    });

    try {
      const match = (aiRes.content || '').match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          summary: parsed.summary || 'Customer inquiry addressed.',
          resolutionStatus: ['resolved', 'follow_up_needed', 'escalated'].includes(parsed.resolutionStatus)
            ? parsed.resolutionStatus
            : 'resolved',
          suggestedFollowUp: parsed.suggestedFollowUp || undefined,
          keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : ['support'],
        };
      }
    } catch {
      // Fallback if parsing fails
    }

    return {
      summary: aiRes.content?.trim() || 'Conversation completed with customer.',
      resolutionStatus: 'resolved',
      keyTopics: ['customer-inquiry'],
    };
  }
}
