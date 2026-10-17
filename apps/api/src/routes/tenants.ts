import { Router, Request, Response } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export function createTenantsRouter(db: DatabaseInstance): Router {
  const router = Router();

  // GET /api/v1/tenants/:tenantId/overview - Real metrics computed live
  router.get(
    '/:tenantId/overview',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const [callsCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.callSessions)
        .where(eq(schema.callSessions.tenantId, tenantId));

      const [activeConvCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.status, 'active')
          )
        );

      const [waitingAgentCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.status, 'waiting_agent')
          )
        );

      const [pendingCallbacks] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.callbackRequests)
        .where(
          and(
            eq(schema.callbackRequests.tenantId, tenantId),
            eq(schema.callbackRequests.status, 'pending')
          )
        );

      const [knowledgeDocsCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.tenantId, tenantId));

      res.json({
        totalCalls: Number(callsCount?.count || 0),
        activeConversations: Number(activeConvCount?.count || 0),
        waitingForAgent: Number(waitingAgentCount?.count || 0),
        pendingCallbacks: Number(pendingCallbacks?.count || 0),
        indexedDocuments: Number(knowledgeDocsCount?.count || 0),
      });
    }
  );

  // GET /api/v1/tenants/:tenantId/settings
  router.get(
    '/:tenantId/settings',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const [settings] = await db
        .select()
        .from(schema.businessSettings)
        .where(eq(schema.businessSettings.tenantId, tenantId));

      const [tenant] = await db
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId));

      res.json({
        tenant,
        settings,
      });
    }
  );

  // PUT /api/v1/tenants/:tenantId/settings
  router.put(
    '/:tenantId/settings',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const b = req.body;

      const [updated] = await db
        .update(schema.businessSettings)
        .set({
          businessName: b.businessName,
          timezone: b.timezone,
          businessHours: b.businessHours,
          fallbackPhone: b.fallbackPhone,
          aiGreeting: b.aiGreeting,
          identifyAsAi: b.identifyAsAi ?? true,
          recordingConsentText: b.recordingConsentText,
          recordingConsentRequired: b.recordingConsentRequired ?? true,
          retentionDays: b.retentionDays ? Number(b.retentionDays) : 90,
          transferTimeoutSeconds: b.transferTimeoutSeconds ? Number(b.transferTimeoutSeconds) : 30,
          afterHoursBehavior: b.afterHoursBehavior || 'callback',
          updatedAt: new Date(),
        })
        .where(eq(schema.businessSettings.tenantId, tenantId))
        .returning();

      res.json({ settings: updated });
    }
  );

  // GET /api/v1/tenants/:tenantId/members
  router.get(
    '/:tenantId/members',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const members = await db
        .select({
          membershipId: schema.tenantMemberships.id,
          userId: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
          role: schema.tenantMemberships.role,
          createdAt: schema.tenantMemberships.createdAt,
        })
        .from(schema.tenantMemberships)
        .innerJoin(schema.users, eq(schema.tenantMemberships.userId, schema.users.id))
        .where(eq(schema.tenantMemberships.tenantId, tenantId));

      res.json({ members });
    }
  );

  // POST /api/v1/tenants/:tenantId/members - Add or invite team member
  router.post(
    '/:tenantId/members',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { email, name, role, initialPassword } = req.body;

      if (!email || !name || !role) {
        res.status(400).json({ error: 'Email, name, and role are required.' });
        return;
      }

      // Check if user exists
      let [existingUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email.toLowerCase().trim()));

      if (!existingUser) {
        const passwordHash = await bcrypt.hash(initialPassword || 'DefaultPassword123!', 10);
        [existingUser] = await db
          .insert(schema.users)
          .values({
            id: `user_${crypto.randomUUID()}`,
            email: email.toLowerCase().trim(),
            name,
            passwordHash,
            systemRole: 'user',
            isActive: true,
          })
          .returning();
      }

      const [membership] = await db
        .insert(schema.tenantMemberships)
        .values({
          id: `mem_${crypto.randomUUID()}`,
          tenantId,
          userId: existingUser.id,
          role: role || 'agent',
        })
        .onConflictDoNothing()
        .returning();

      res.status(201).json({
        membership,
        user: { id: existingUser.id, email: existingUser.email, name: existingUser.name },
      });
    }
  );

  return router;
}
