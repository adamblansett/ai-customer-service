import type { DatabaseInstance } from '@customer-service/db';
import * as schema from '@customer-service/db/schema';
import { eq, and } from 'drizzle-orm';
import { ConversationManager } from '../conversation/manager.js';
import { KnowledgeRetriever } from '../knowledge/retriever.js';
import { AiProvider } from '../ai/provider.interface.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import { ToolRegistry } from '../safety/tool-registry.js';
import { detectPromptInjection, wrapUntrustedContext } from '../safety/injection-defense.js';

export interface InboundEmailPayload {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
}

export interface EmailResponseOutput {
  to: string;
  from: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  conversationId: string;
}

export class EmailAdapter {
  /**
   * Normalizes inbound email webhook payloads from SendGrid, Postmark, Mailgun, or standard JSON.
   */
  public static parseInbound(body: Record<string, any>): InboundEmailPayload {
    // SendGrid format: from, to, subject, text, html, headers (with Message-ID)
    // Postmark format: From, To, Subject, TextBody, HtmlBody, MessageID
    // Mailgun format: sender/from, recipient, subject, stripped-text, Message-Id

    const from =
      body.From ||
      body.from ||
      body.sender ||
      (body.envelope ? JSON.parse(body.envelope || '{}').from : '');

    const to =
      body.To ||
      body.to ||
      body.recipient ||
      (body.envelope ? JSON.parse(body.envelope || '{}').to?.[0] : '');

    const subject = body.Subject || body.subject || '(No Subject)';
    const text = body.TextBody || body['stripped-text'] || body.text || body.body || '';
    const html = body.HtmlBody || body['stripped-html'] || body.html || undefined;
    const messageId =
      body.MessageID ||
      body['Message-Id'] ||
      body.messageId ||
      `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const inReplyTo = body['In-Reply-To'] || body.inReplyTo || undefined;

    // Extract bare email address from "First Last <email@domain.com>"
    const emailMatch = from.match(/<([^>]+)>/);
    const cleanEmail = emailMatch ? emailMatch[1].trim() : from.trim();

    return {
      messageId,
      from: cleanEmail,
      to: typeof to === 'string' ? to.trim() : '',
      subject: subject.trim(),
      text: text.trim(),
      html,
      inReplyTo,
    };
  }

  /**
   * Renders a normalized outbound email response object.
   */
  public static renderReply(params: {
    to: string;
    from: string;
    subject: string;
    text: string;
    inReplyTo?: string;
  }): { to: string; from: string; subject: string; text: string; inReplyTo?: string } {
    const replySubject = params.subject.toLowerCase().startsWith('re:')
      ? params.subject
      : `Re: ${params.subject}`;

    return {
      to: params.to,
      from: params.from,
      subject: replySubject,
      text: params.text,
      inReplyTo: params.inReplyTo,
    };
  }
}

export class EmailConversationHandler {
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
   * Processes an inbound email turn end-to-end.
   */
  public async handleInbound(
    tenantId: string,
    email: InboundEmailPayload
  ): Promise<EmailResponseOutput> {
    if (!email.from) {
      throw new Error('Inbound email must specify a valid sender address.');
    }

    // 1. Resolve or create customer record by email
    let customer = await this.db.query.customers.findFirst({
      where: and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, email.from)),
    });

    if (!customer) {
      const emailUsername = email.from.split('@')[0] || 'Customer';
      const capitalized = emailUsername.charAt(0).toUpperCase() + emailUsername.slice(1);
      const customerId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const [newCust] = await this.db
        .insert(schema.customers)
        .values({
          id: customerId,
          tenantId,
          name: `${capitalized} (Email)`,
          email: email.from,
        })
        .returning();
      customer = newCust;
    }

    // 2. Fetch tenant business settings
    const settings = await this.db.query.businessSettings.findFirst({
      where: eq(schema.businessSettings.tenantId, tenantId),
    });

    const businessName = settings?.businessName || 'Customer Service';

    // 3. Find active conversation or create a new email conversation
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
        channel: 'email',
      });
    }

    // 4. Save inbound customer email message
    await this.convManager.addMessage({
      conversationId: conversation.id,
      tenantId,
      senderType: 'customer',
      content: email.text || email.subject,
      metadata: {
        messageId: email.messageId,
        subject: email.subject,
      },
    });

    // 5. Prompt injection defense
    const injectionCheck = detectPromptInjection(email.text);
    if (injectionCheck.isSuspicious) {
      const safetyReply =
        `Thank you for contacting ${businessName}.\n\n` +
        `We received your request, but your message contained content that triggered our safety filter. ` +
        `A support representative will review your inquiry and follow up shortly.\n\n` +
        `Best regards,\n${businessName} Support`;

      await this.convManager.addMessage({
        conversationId: conversation.id,
        tenantId,
        senderType: 'ai_agent',
        content: safetyReply,
      });

      return {
        to: email.from,
        from: email.to || 'support@example.com',
        subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`,
        text: safetyReply,
        inReplyTo: email.messageId,
        conversationId: conversation.id,
      };
    }

    // 6. Retrieve relevant knowledge base chunks
    const knowledgeChunks = await this.retriever.search(tenantId, email.text || email.subject, {
      limit: 3,
    });

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

    // 7. Synthesize AI email response
    const systemPrompt =
      `You are an AI customer support representative for ${businessName}.\n` +
      `Answer the customer's email inquiry clearly, professionally, and accurately using ONLY the verified business information below.\n` +
      `If the question cannot be answered from the provided knowledge, politely explain that you are escalating to a human team member.\n` +
      `Format your output as a professional email body with a greeting and signature.\n\n` +
      `VERIFIED BUSINESS KNOWLEDGE:\n${safeContext}`;

    const aiResult = await this.aiProvider.generate({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Subject: ${email.subject}\n\n${email.text}` },
      ],
      temperature: 0.2,
      maxTokens: 500,
    });

    const replyText =
      aiResult.content?.trim() ||
      `Thank you for reaching out to ${businessName}. A representative will review your message and reply soon.`;

    // 8. Record assistant reply message
    await this.convManager.addMessage({
      conversationId: conversation.id,
      tenantId,
      senderType: 'ai_agent',
      content: replyText,
    });

    return {
      to: email.from,
      from: email.to || 'support@example.com',
      subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`,
      text: replyText,
      inReplyTo: email.messageId,
      conversationId: conversation.id,
    };
  }
}
