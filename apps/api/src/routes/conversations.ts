import { Router, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import { ConversationManager, ChannelType } from '@customer-service/core';

export function createConversationsRouter(db: DatabaseInstance): Router {
  const router = Router();
  const convManager = new ConversationManager(db);

  // GET /api/v1/tenants/:tenantId/conversations - List with filters
  router.get(
    '/:tenantId/conversations',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const statusFilter = req.query.status as string;
      const channelFilter = req.query.channel as string;

      const conditions = [eq(schema.conversations.tenantId, tenantId)];
      if (statusFilter && statusFilter !== 'all') {
        conditions.push(eq(schema.conversations.status, statusFilter));
      }
      if (channelFilter && channelFilter !== 'all') {
        conditions.push(eq(schema.conversations.channel, channelFilter));
      }

      const rows = await db
        .select({
          id: schema.conversations.id,
          channel: schema.conversations.channel,
          status: schema.conversations.status,
          escalationState: schema.conversations.escalationState,
          escalationReason: schema.conversations.escalationReason,
          summary: schema.conversations.summary,
          assignedAgentId: schema.conversations.assignedAgentId,
          createdAt: schema.conversations.createdAt,
          updatedAt: schema.conversations.updatedAt,
          customerName: schema.customers.name,
          customerPhone: schema.customers.phoneNumber,
        })
        .from(schema.conversations)
        .leftJoin(schema.customers, eq(schema.conversations.customerId, schema.customers.id))
        .where(and(...conditions))
        .orderBy(desc(schema.conversations.updatedAt))
        .limit(50);

      res.json({ conversations: rows });
    }
  );

  // GET /api/v1/tenants/:tenantId/conversations/:id - Detail & message thread
  router.get(
    '/:tenantId/conversations/:id',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, id } = req.params;

      const data = await convManager.getConversationWithMessages({
        conversationId: id,
        tenantId,
      });

      if (!data) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      res.json(data);
    }
  );

  // POST /api/v1/tenants/:tenantId/conversations/:id/messages - Send message (e.g. human agent reply)
  router.post(
    '/:tenantId/conversations/:id/messages',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, id } = req.params;
      const { content } = req.body;

      if (!content || !content.trim()) {
        res.status(400).json({ error: 'Message content is required.' });
        return;
      }

      const message = await convManager.addMessage({
        conversationId: id,
        tenantId,
        senderType: 'human_agent',
        senderId: req.user?.userId,
        content: content.trim(),
      });

      res.status(201).json({ message });
    }
  );

  // POST /api/v1/tenants/:tenantId/conversations/:id/assign - Assign agent to conversation
  router.post(
    '/:tenantId/conversations/:id/assign',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, id } = req.params;
      const agentUserId = req.body.agentUserId || req.user?.userId;

      if (!agentUserId) {
        res.status(400).json({ error: 'agentUserId is required.' });
        return;
      }

      const updated = await convManager.assignAgent({
        conversationId: id,
        tenantId,
        agentUserId,
      });

      res.json({ conversation: updated });
    }
  );

  // POST /api/v1/tenants/:tenantId/conversations/:id/close - Safely close conversation
  router.post(
    '/:tenantId/conversations/:id/close',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, id } = req.params;
      const { summary } = req.body;

      const updated = await convManager.updateStatus({
        conversationId: id,
        tenantId,
        newStatus: 'closed',
        reason: summary || 'Closed by agent',
      });

      res.json({ conversation: updated });
    }
  );

  return router;
}
