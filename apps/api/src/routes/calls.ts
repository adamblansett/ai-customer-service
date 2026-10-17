import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { AudioBridgeManager, type SupervisorMode } from '@customer-service/core';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

export const sharedAudioBridgeManager = new AudioBridgeManager();

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

  // POST /api/v1/tenants/:tenantId/calls/:callSid/coaching - Supervisor silent_monitor / whisper / barge_in
  router.post(
    '/:tenantId/calls/:callSid/coaching',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { callSid } = req.params;
      const mode: SupervisorMode = req.body.mode || 'silent_monitor';
      const supervisorId = req.user?.userId || 'supervisor_001';

      if (!['silent_monitor', 'whisper', 'barge_in'].includes(mode)) {
        res.status(400).json({ error: 'Invalid coaching mode. Must be silent_monitor, whisper, or barge_in.' });
        return;
      }

      // Ensure caller and agent are registered on the bridge if not already present
      let bridge = sharedAudioBridgeManager.getBridge(callSid);
      if (!bridge) {
        bridge = sharedAudioBridgeManager.createBridge(callSid, callSid);
        sharedAudioBridgeManager.joinParticipant(callSid, 'caller_leg', 'caller');
        sharedAudioBridgeManager.joinParticipant(callSid, 'agent_leg', 'agent');
      }

      const existingSupervisor = bridge.participants.get(supervisorId);
      if (!existingSupervisor) {
        sharedAudioBridgeManager.joinParticipant(callSid, supervisorId, 'supervisor', mode);
      } else {
        sharedAudioBridgeManager.setSupervisorMode(callSid, supervisorId, mode);
      }

      const supervisorRecipients = sharedAudioBridgeManager.getRecipients(callSid, supervisorId);
      const participants = Array.from(bridge.participants.values());

      res.status(200).json({
        callSid,
        supervisorId,
        mode,
        supervisorAudioRecipients: supervisorRecipients,
        participants,
      });
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
      const { id } = req.params;
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
