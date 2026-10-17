import type { DatabaseInstance } from '@customer-service/db';
import * as schema from '@customer-service/db/schema';
import { eq, and } from 'drizzle-orm';
import { ConversationManager } from '../conversation/manager.js';
import { KnowledgeRetriever } from '../knowledge/retriever.js';
import { AiProvider } from '../ai/provider.interface.js';
import { ToolRegistry } from '../safety/tool-registry.js';
import { detectPromptInjection, wrapUntrustedContext } from '../safety/injection-defense.js';


function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface InboundSmsPayload {
  messageSid: string;
  from: string;
  to: string;
  body: string;
  numMedia?: number;
}

export interface SmsResponseOutput {
  twiml: string;
  responseText: string;
  conversationId: string;
}

export class SmsAdapter {
  /**
   * Generates TwiML Messaging XML reply.
   */
  public static renderReply(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Message>${escapeXml(message)}</Message>\n</Response>`;
  }

  /**
   * Normalizes inbound Twilio SMS payload.
   */
  public static parseInbound(body: Record<string, any>): InboundSmsPayload {
    return {
      messageSid: body.MessageSid || body.SmsMessageSid || `sms_${Date.now()}`,
      from: body.From || '',
      to: body.To || '',
      body: body.Body ? body.Body.trim() : '',
      numMedia: body.NumMedia ? parseInt(body.NumMedia, 10) : 0,
    };
  }
}

export class SmsConversationHandler {
  private db: DatabaseInstance;
  private convManager: ConversationManager;
  private retriever: KnowledgeRetriever;
  private aiProvider: AiProvider;
  private toolRegistry: ToolRegistry;

  constructor(db: DatabaseInstance, aiProvider: AiProvider) {
    this.db = db;
    this.convManager = new ConversationManager(db);
    this.retriever = new KnowledgeRetriever(db);
    this.aiProvider = aiProvider;
    this.toolRegistry = new ToolRegistry(db);
  }

  /**
   * Processes an incoming SMS message end-to-end.
   */
  public async handleInboundSms(params: {
    tenantId: string;
    from: string;
    to: string;
    body: string;
    messageSid: string;
  }): Promise<SmsResponseOutput> {
    const { tenantId, from, body, messageSid } = params;

    // 1. Resolve or create customer
    let [customer] = await this.db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phoneNumber, from)));

    if (!customer) {
      const customerId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const [newCust] = await this.db
        .insert(schema.customers)
        .values({
          id: customerId,
          tenantId,
          phoneNumber: from,
          name: `SMS User (${from.slice(-4)})`,
        })
        .returning();
      customer = newCust;
    }


    // 2. Resolve active conversation on SMS channel or create new one
    const activeConvs = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.tenantId, tenantId),
          eq(schema.conversations.customerId, customer.id),
          eq(schema.conversations.channel, 'sms'),
          eq(schema.conversations.status, 'active')
        )
      );

    let conv = activeConvs[0];
    if (!conv) {
      conv = await this.convManager.createConversation({
        tenantId,
        customerId: customer.id,
        channel: 'sms',
        metadata: { initialMessageSid: messageSid },
      });
    }

    // 3. Append customer message
    await this.convManager.addMessage({
      conversationId: conv.id,
      tenantId,
      senderType: 'customer',
      content: body,
      metadata: { messageSid },
    });

    // 4. Check for prompt injection
    const injectionCheck = detectPromptInjection(body);
    if (injectionCheck.isSuspicious) {
      const refusalText = 'I am sorry, but I cannot fulfill that request.';
      await this.convManager.addMessage({
        conversationId: conv.id,
        tenantId,
        senderType: 'ai_agent',
        content: refusalText,
      });

      return {
        twiml: SmsAdapter.renderReply(refusalText),
        responseText: refusalText,
        conversationId: conv.id,
      };
    }

    // 5. Query knowledge base
    const knowledgeResults = await this.retriever.search(tenantId, body, { limit: 2 });

    let contextText = '';
    if (knowledgeResults.length > 0) {
      const chunks = knowledgeResults
        .map((r) => `Title: ${r.documentTitle}\n${r.content}`)
        .join('\n\n');
      contextText = wrapUntrustedContext('retrieved_context', chunks);
    }


    // 6. Generate AI response (tuned for SMS brevity)
    const [settings] = await this.db
      .select()
      .from(schema.businessSettings)
      .where(eq(schema.businessSettings.tenantId, tenantId));

    const businessName = settings?.businessName || 'Customer Service';
    const systemPrompt = `You are an automated SMS customer service assistant for ${businessName}.
Answer customer questions accurately and concisely using the approved knowledge context below.
KEEP REPLIES SHORT: Maximum 2 sentences (under 160 characters when possible).
If you do not know the answer, politely ask them to call us or offer to have an agent call them.

${contextText}`;

    const convHistory = await this.convManager.getConversationWithMessages({
      conversationId: conv.id,
      tenantId,
    });

    const messages: import('../ai/types.js').AiMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(convHistory?.messages || []).slice(-6).map((m) => ({
        role: (m.senderType === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const completion = await this.aiProvider.generate({
      messages,
      maxTokens: 100,
      temperature: 0.2,
    });

    let responseText = completion.content.trim();

    if (!responseText) {
      responseText = `Thanks for reaching out to ${businessName}. How can we assist you today?`;
    }

    // 7. Save AI response
    await this.convManager.addMessage({
      conversationId: conv.id,
      tenantId,
      senderType: 'ai_agent',
      content: responseText,
    });

    return {
      twiml: SmsAdapter.renderReply(responseText),
      responseText,
      conversationId: conv.id,
    };
  }
}
