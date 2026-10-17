import { Router, Request, Response } from 'express';
import { eq, and, lt } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

export function createPrivacyRouter(db: DatabaseInstance): Router {
  const router = Router();

  // POST /api/v1/tenants/:tenantId/privacy/purge - Enforces retention policy by purging expired records
  router.post(
    '/:tenantId/privacy/purge',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      // 1. Get tenant retention days
      const [settings] = await db
        .select()
        .from(schema.businessSettings)
        .where(eq(schema.businessSettings.tenantId, tenantId));

      const retentionDays = settings?.retentionDays ?? 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // 2. Delete conversations closed before cutoff date
      const deletedConversations = await db
        .delete(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.status, 'closed'),
            lt(schema.conversations.closedAt, cutoffDate)
          )
        )
        .returning();

      // 3. Purge old call sessions
      const deletedCallSessions = await db
        .delete(schema.callSessions)
        .where(
          and(
            eq(schema.callSessions.tenantId, tenantId),
            lt(schema.callSessions.createdAt, cutoffDate)
          )
        )
        .returning();

      res.json({
        success: true,
        retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        purgedConversationsCount: deletedConversations.length,
        purgedCallSessionsCount: deletedCallSessions.length,
      });
    }
  );

  // GET /api/v1/tenants/:tenantId/privacy/export - Data export for compliance / GDPR / CCPA
  router.post(
    '/:tenantId/privacy/export',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { phoneNumber, email } = req.body;

      if (!phoneNumber && !email) {
        res.status(400).json({ error: 'phoneNumber or email is required for customer data export.' });
        return;
      }

      // Query customer records
      const conditions = [eq(schema.customers.tenantId, tenantId)];
      if (phoneNumber) conditions.push(eq(schema.customers.phoneNumber, phoneNumber));
      if (email) conditions.push(eq(schema.customers.email, email));

      const customerRows = await db
        .select()
        .from(schema.customers)
        .where(and(...conditions));

      // Query customer's conversations
      const customerIds = customerRows.map(c => c.id);
      let conversationsList: any[] = [];

      if (customerIds.length > 0) {
        for (const cid of customerIds) {
          const convs = await db
            .select()
            .from(schema.conversations)
            .where(
              and(
                eq(schema.conversations.tenantId, tenantId),
                eq(schema.conversations.customerId, cid)
              )
            );
          conversationsList.push(...convs);
        }
      }

      res.json({
        tenantId,
        exportedAt: new Date().toISOString(),
        customers: customerRows,
        conversations: conversationsList,
      });
    }
  );

  return router;
}
