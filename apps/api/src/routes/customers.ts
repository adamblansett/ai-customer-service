import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { CustomerJourneyManager } from '@customer-service/core';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

export function createCustomersRouter(db: DatabaseInstance): Router {
  const router = Router();
  const journeyManager = new CustomerJourneyManager(db);

  // GET /api/v1/tenants/:tenantId/customers - List Customers
  router.get(
    '/:tenantId/customers',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const customers = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.tenantId, tenantId))
        .orderBy(desc(schema.customers.createdAt))
        .limit(50);

      res.json({ customers });
    }
  );

  // GET /api/v1/tenants/:tenantId/customers/:customerId/journey - Customer 360 Profile & Timeline
  router.get(
    '/:tenantId/customers/:customerId/journey',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, customerId } = req.params;

      const profile = await journeyManager.buildCustomer360(tenantId, customerId);
      if (!profile) {
        res.status(404).json({ error: `Customer ${customerId} not found.` });
        return;
      }

      res.json({ profile });
    }
  );

  // POST /api/v1/tenants/:tenantId/customers/merge - Merge Customer Identities
  router.post(
    '/:tenantId/customers/merge',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { primaryCustomerId, secondaryCustomerId } = req.body;

      if (!primaryCustomerId || !secondaryCustomerId) {
        res.status(400).json({ error: 'primaryCustomerId and secondaryCustomerId are required.' });
        return;
      }

      try {
        const merged = await journeyManager.mergeCustomers(
          tenantId,
          primaryCustomerId,
          secondaryCustomerId
        );
        res.json({ success: true, profile: merged });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Customer merge failed' });
      }
    }
  );

  return router;
}
