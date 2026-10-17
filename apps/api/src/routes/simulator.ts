import { Router, Request, Response } from 'express';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import { VoiceCallSimulator } from '@customer-service/core';
import { MockAiProvider } from '@customer-service/core';

export function createSimulatorRouter(db: DatabaseInstance): Router {
  const router = Router();
  const simulator = new VoiceCallSimulator(db, new MockAiProvider());

  // POST /api/v1/tenants/:tenantId/simulator/start
  router.post(
    '/:tenantId/simulator/start',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { fromNumber, toNumber } = req.body;

      try {
        const result = await simulator.simulateCallStart({
          tenantId,
          fromNumber: fromNumber || '+15550101',
          toNumber: toNumber || '+15550100',
        });

        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/v1/tenants/:tenantId/simulator/utterance
  router.post(
    '/:tenantId/simulator/utterance',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { callSid, utterance, evaluationTime } = req.body;

      if (!callSid || !utterance) {
        res.status(400).json({ error: 'callSid and utterance are required.' });
        return;
      }

      try {
        const result = await simulator.simulateCallerUtterance({
          tenantId,
          callSid,
          utterance,
          evaluationTime: evaluationTime ? new Date(evaluationTime) : undefined,
        });

        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/v1/tenants/:tenantId/simulator/transfer-fail
  router.post(
    '/:tenantId/simulator/transfer-fail',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { callSid, reason } = req.body;

      if (!callSid) {
        res.status(400).json({ error: 'callSid is required.' });
        return;
      }

      try {
        const result = await simulator.simulateTransferFailure({
          tenantId,
          callSid,
          failureReason: (reason as 'busy' | 'no-answer' | 'timeout') || 'busy',
        });

        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/v1/tenants/:tenantId/simulator/end
  router.post(
    '/:tenantId/simulator/end',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { callSid, durationSeconds } = req.body;

      if (!callSid) {
        res.status(400).json({ error: 'callSid is required.' });
        return;
      }

      await simulator.simulateCallEnd({
        tenantId,
        callSid,
        durationSeconds: Number(durationSeconds || 60),
      });

      res.json({ success: true, message: 'Call ended successfully.' });
    }
  );

  return router;
}
