import type { DatabaseInstance } from '@customer-service/db';
import * as schema from '@customer-service/db/schema';
import { eq, and } from 'drizzle-orm';
import { ConversationManager } from '../conversation/manager.js';
import { KnowledgeRetriever } from '../knowledge/retriever.js';
import { AiProvider } from '../ai/provider.interface.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import { ToolRegistry } from '../safety/tool-registry.js';
import { detectPromptInjection, wrapUntrustedContext } from '../safety/injection-defense.js';

export interface WhatsAppInboundMessage {
  id: string;
  from: string; // e.g. "15551234567"
  timestamp: string;
  type: string;
  text?: string;
  phoneNumberId?: string;
}

export interface WhatsAppResponseOutput {
  responsePayload: Record<string, any>;
  responseText: string;
  conversationId: string;
}

export class WhatsAppAdapter {
  /**
   * Verifies incoming Meta Graph API Webhook subscription handshake.
   */
  public static verifyWebhook(
    query: Record<string, any>,
    expectedVerifyToken: string
  ): { isValid: boolean; challenge?: string } {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === expectedVerifyToken) {
      return { isValid: true, challenge };
    }
    return { isValid: false };
  }

  /**
   * Parses inbound messages from Meta Graph API webhook notifications.
   */
  public static parseInbound(body: Record<string, any>): WhatsAppInboundMessage[] {
    const results: WhatsAppInboundMessage[] = [];
    if (!body || !body.entry || !Array.isArray(body.entry)) return results;

    for (const entry of body.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        const val = change.value;
        if (!val || !val.messages || !Array.isArray(val.messages)) continue;
        const phoneNumberId = val.metadata?.phone_number_id;

        for (const msg of val.messages) {
          let text = '';
          if (msg.type === 'text' && msg.text?.body) {
            text = msg.text.body;
          } else if (msg.type === 'button' && msg.button?.text) {
            text = msg.button.text;
          } else if (msg.type === 'interactive' && msg.interactive?.button_reply?.title) {
            text = msg.interactive.button_reply.title;
          }

          results.push({
            id: msg.id || `wamid_${Date.now()}`,
            from: msg.from || '',
            timestamp: msg.timestamp || String(Math.floor(Date.now() / 1000)),
            type: msg.type || 'text',
            text: text.trim(),
            phoneNumberId,
          });
        }
      }
    }

    return results;
  }

  /**
   * Renders Meta Graph API outbound message payload.
   */
  public static renderTextMessage(to: string, text: string): Record<string, any> {
    const cleanTo = to.replace(/^\+/, '');
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };
  }
}

export class WhatsAppConversationHandler {
  private db: DatabaseInstance;
  private convManager: ConversationManager;
  private retriever: KnowledgeRetriever;
  private aiProvider: AiProvider;
  private toolRegistry: ToolRegistry;

  constructor(
    db: DatabaseInstance,
    aiProvider: AiProvider = new MockAiProvider(),
    convManager?: ConversationManager,
    retriever?: KnowledgeRetriever,
    toolRegistry?: ToolRegistry
  ) {
    this.db = db;
    this.aiProvider = aiProvider;
    this.convManager = convManager || new ConversationManager(db);
    this.retriever = retriever || new KnowledgeRetriever(db);
    this.toolRegistry = toolRegistry || new ToolRegistry(db);
  }

  /**
   * Handles inbound WhatsApp message turn end-to-end.
   */
  public async handleInbound(
    tenantId: string,
    message: WhatsAppInboundMessage
  ): Promise<WhatsAppResponseOutput> {
    if (!message.from) {
      throw new Error('Inbound WhatsApp message must specify a sender phone number.');
    }

    const formattedPhone = message.from.startsWith('+') ? message.from : `+${message.from}`;

    // 1. Resolve or create customer record by phone number
    let customer = await this.db.query.customers.findFirst({
      where: and(
        eq(schema.customers.tenantId, tenantId),
        eq(schema.customers.phoneNumber, formattedPhone)
      ),
    });

    if (!customer) {
      const customerId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const [newCust] = await this.db
        .insert(schema.customers)
        .values({
          id: customerId,
          tenantId,
          name: `WhatsApp Customer (${formattedPhone.slice(-4)})`,
          phoneNumber: formattedPhone,
        })
        .returning();
      customer = newCust;
    }

    // 2. Fetch tenant business settings
    const settings = await this.db.query.businessSettings.findFirst({
      where: eq(schema.businessSettings.tenantId, tenantId),
    });

    const businessName = settings?.businessName || 'Customer Service';

    // 3. Find active conversation or create new WhatsApp conversation
    let conversation = await this.db.query.conversations.findFirst({
      where: and(
        eq(schema.conversations.tenantId, tenantId),
        eq(schema.conversations.customerId, customer.id),
        eq(schema.conversations.status, 'active')
      ),
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });

    if (!conversation) {
      conversation = await this.convManager.createConversation({
        tenantId,
        customerId: customer.id,
        channel: 'whatsapp',
      });
    }

    const userText = message.text || '(empty message)';

    // 4. Save inbound customer message
    await this.convManager.addMessage({
      conversationId: conversation.id,
      tenantId,
      senderType: 'customer',
      content: userText,
      metadata: {
        whatsAppMessageId: message.id,
        timestamp: message.timestamp,
      },
    });

    // 5. Prompt injection defense
    const injectionCheck = detectPromptInjection(userText);
    if (injectionCheck.isSuspicious) {
      const safetyReply =
        `We noticed your message contained disallowed system instructions. ` +
        `An agent from ${businessName} will review your inquiry.`;

      await this.convManager.addMessage({
        conversationId: conversation.id,
        tenantId,
        senderType: 'ai_agent',
        content: safetyReply,
      });

      return {
        responsePayload: WhatsAppAdapter.renderTextMessage(message.from, safetyReply),
        responseText: safetyReply,
        conversationId: conversation.id,
      };
    }

    // 6. Retrieve relevant knowledge base chunks
    const knowledgeChunks = await this.retriever.search(tenantId, userText, { limit: 3 });
    let contextSnippet = '';
    if (knowledgeChunks.length > 0) {
      contextSnippet = knowledgeChunks
        .map((c) => `[Source: ${c.documentTitle}]\n${c.content}`)
        .join('\n\n');
    }

    const safeContext = wrapUntrustedContext(
      'business_knowledge',
      contextSnippet || 'No additional documents.'
    );

    // 7. Synthesize AI response
    const systemPrompt =
      `You are a WhatsApp AI customer assistant for ${businessName}.\n` +
      `Keep responses concise, clear, and helpful for mobile chat (1 to 3 short sentences).\n` +
      `Use ONLY the verified business knowledge below. If you cannot answer, offer to connect with a representative.\n\n` +
      `VERIFIED BUSINESS KNOWLEDGE:\n${safeContext}`;

    const aiResult = await this.aiProvider.generate({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      temperature: 0.2,
      maxTokens: 180,
    });

    const replyText =
      aiResult.content?.trim() ||
      `Thanks for messaging ${businessName}. A representative will respond shortly.`;

    // 8. Record assistant reply message
    await this.convManager.addMessage({
      conversationId: conversation.id,
      tenantId,
      senderType: 'ai_agent',
      content: replyText,
    });

    return {
      responsePayload: WhatsAppAdapter.renderTextMessage(message.from, replyText),
      responseText: replyText,
      conversationId: conversation.id,
    };
  }
}
