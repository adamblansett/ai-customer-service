import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

export function createCallsRouter(db: DatabaseInstance): Router {
  const router = Router();

  // GET /api/v1/tenants/:tenantId/calls - List recent telephony call sessions
  router.get(
    '/:tenantId/calls',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const sessions = await db
        .select()
        .from(schema.callSessions)
        .where(eq(schema.callSessions.tenantId, tenantId))
        .orderBy(desc(schema.callSessions.createdAt))
        .limit(50);

      res.json({ calls: sessions });
    }
  );

  // GET /api/v1/tenants/:tenantId/callbacks - List callback requests
  router.get(
    '/:tenantId/callbacks',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const requests = await db
        .select()
        .from(schema.callbackRequests)
        .where(eq(schema.callbackRequests.tenantId, tenantId))
        .orderBy(desc(schema.callbackRequests.requestedAt))
        .limit(50);

      res.json({ callbacks: requests });
    }
  );

  // POST /api/v1/tenants/:tenantId/callbacks/:id/complete - Mark completed
  router.post(
    '/:tenantId/callbacks/:id/complete',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, id } = req.params;
      const { notes } = req.body;

      const [updated] = await db
        .update(schema.callbackRequests)
        .set({
          status: 'completed',
          assignedAgentId: req.user?.userId,
          completedAt: new Date(),
          notes: notes || null,
        })
        .where(eq(schema.callbackRequests.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'Callback request not found.' });
        return;
      }

      res.json({ callback: updated });
    }
  );

  return router;
}
