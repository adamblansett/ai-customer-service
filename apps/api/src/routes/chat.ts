import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { ConversationManager, KnowledgeRetriever, MockAiProvider, ToolRegistry } from '@customer-service/core';

export function createChatRouter(db: DatabaseInstance): Router {
  const router = Router();
  const convManager = new ConversationManager(db);
  const retriever = new KnowledgeRetriever(db);
  const toolRegistry = new ToolRegistry(db);
  const defaultProvider = new MockAiProvider();

  // POST /api/v1/chat/public/session - Initialize public website chat session
  router.post('/public/session', async (req: Request, res: Response): Promise<void> => {
    const { tenantSlug, customerName, customerEmail } = req.body;

    if (!tenantSlug) {
      res.status(400).json({ error: 'tenantSlug is required.' });
      return;
    }

    const [tenant] = await db
      .select()
      .from(schema.tenants)
      .where(
        and(
          eq(schema.tenants.slug, tenantSlug),
          eq(schema.tenants.status, 'active')
        )
      );

    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found or inactive.' });
      return;
    }

    const [settings] = await db
      .select()
      .from(schema.businessSettings)
      .where(eq(schema.businessSettings.tenantId, tenant.id));

    // Optional customer link
    let customerId: string | undefined;
    if (customerEmail) {
      const [existingCust] = await db
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, tenant.id),
            eq(schema.customers.email, customerEmail.toLowerCase().trim())
          )
        );
      customerId = existingCust?.id;
    }

    const greeting = settings?.aiGreeting || 'Hello! How can I assist you with your customer service inquiry today?';

    const conv = await convManager.createConversation({
      tenantId: tenant.id,
      channel: 'chat',
      customerId,
      metadata: { origin: req.headers.origin || 'embed_widget', customerName },
    });

    // Record initial greeting
    await convManager.addMessage({
      conversationId: conv.id,
      tenantId: tenant.id,
      senderType: 'ai_agent',
      content: greeting,
    });

    res.status(201).json({
      sessionId: conv.id,
      tenantId: tenant.id,
      businessName: settings?.businessName || tenant.name,
      greeting,
      identifyAsAi: settings?.identifyAsAi ?? true,
    });
  });

  // POST /api/v1/chat/public/message - Send message in public chat session
  router.post('/public/message', async (req: Request, res: Response): Promise<void> => {
    const { sessionId, content } = req.body;

    if (!sessionId || !content || !content.trim()) {
      res.status(400).json({ error: 'sessionId and content are required.' });
      return;
    }

    // Lookup conversation
    const [conv] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, sessionId));

    if (!conv || conv.status === 'closed') {
      res.status(404).json({ error: 'Chat session not found or has been closed.' });
      return;
    }

    const tenantId = conv.tenantId;

    // 1. Record customer message
    const customerMsg = await convManager.addMessage({
      conversationId: conv.id,
      tenantId,
      senderType: 'customer',
      content: content.trim(),
    });

    // 2. Search knowledge base for relevant approved business information
    const searchResults = await retriever.search(tenantId, content.trim(), { limit: 3 });

    let responseContent: string;
    let toolCalls: any[] = [];

    if (searchResults.length > 0 && searchResults[0].score >= 0.4) {
      responseContent = searchResults[0].content;
      toolCalls = [
        {
          name: 'lookup_knowledge',
          args: { query: content },
          result: { title: searchResults[0].documentTitle, score: searchResults[0].score },
        },
      ];
    } else {
      // Check if user requests human escalation
      const lower = content.toLowerCase();
      if (lower.includes('human') || lower.includes('agent') || lower.includes('person') || lower.includes('representative')) {
        await convManager.requestEscalation({
          conversationId: conv.id,
          tenantId,
          reason: 'Customer requested human support via website chat',
        });
        responseContent = 'I have escalated this conversation to our support team. A representative will be with you shortly.';
      } else {
        responseContent = "I don't have that specific information in my approved business sources. Would you like me to transfer you to a human representative?";
      }
    }

    // 3. Record AI message
    const aiMsg = await convManager.addMessage({
      conversationId: conv.id,
      tenantId,
      senderType: 'ai_agent',
      content: responseContent,
      toolCalls,
    });

    res.json({
      reply: {
        id: aiMsg.id,
        content: aiMsg.content,
        senderType: 'ai_agent',
        createdAt: aiMsg.createdAt,
      },
      sources: searchResults.map(s => ({
        title: s.documentTitle,
        sourceUri: s.sourceUri,
        confidence: s.confidence,
      })),
      escalationState: conv.escalationState,
    });
  });

  return router;
}
