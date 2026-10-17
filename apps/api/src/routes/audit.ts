import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

export function createAuditRouter(db: DatabaseInstance): Router {
  const router = Router();

  // GET /api/v1/tenants/:tenantId/audit-logs
  router.get(
    '/:tenantId/audit-logs',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const logs = await db
        .select({
          id: schema.auditEvents.id,
          action: schema.auditEvents.action,
          resourceType: schema.auditEvents.resourceType,
          resourceId: schema.auditEvents.resourceId,
          metadata: schema.auditEvents.metadata,
          ipAddress: schema.auditEvents.ipAddress,
          createdAt: schema.auditEvents.createdAt,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.auditEvents)
        .leftJoin(schema.users, eq(schema.auditEvents.userId, schema.users.id))
        .where(eq(schema.auditEvents.tenantId, tenantId))
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(100);

      res.json({ logs });
    }
  );

  return router;
}
