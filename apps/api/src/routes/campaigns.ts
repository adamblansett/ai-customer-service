import { Router, Request, Response } from 'express';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import {
  OutboundCampaignManager,
  DncRegistry,
  ConversationManager,
} from '@customer-service/core';

export function createCampaignsRouter(db: DatabaseInstance): Router {
  const router = Router();
  const convManager = new ConversationManager(db);
  const campaignManager = new OutboundCampaignManager(convManager);

  // POST /api/v1/tenants/:tenantId/campaigns/dispatch - Dispatch proactive campaign
  router.post(
    '/:tenantId/campaigns/dispatch',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { campaignName, channel, messageTemplate, recipients, bypassCallingHours } = req.body;

      if (!campaignName || !channel || !messageTemplate || !recipients || !Array.isArray(recipients)) {
        res.status(400).json({
          error: 'campaignName, channel (sms|voice), messageTemplate, and recipients array are required.',
        });
        return;
      }

      try {
        const result = await campaignManager.dispatchCampaign({
          tenantId,
          campaignName,
          channel,
          messageTemplate,
          recipients,
          bypassCallingHours: Boolean(bypassCallingHours),
        });

        res.status(200).json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Campaign dispatch failed' });
      }
    }
  );

  // GET /api/v1/tenants/:tenantId/campaigns/dnc - List Do Not Call entries
  router.get(
    '/:tenantId/campaigns/dnc',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const entries = DncRegistry.listNumbers(tenantId);
      res.json({ dncRegistry: entries });
    }
  );

  // POST /api/v1/tenants/:tenantId/campaigns/dnc - Add number to DNC
  router.post(
    '/:tenantId/campaigns/dnc',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { phoneNumber, reason, source } = req.body;

      if (!phoneNumber) {
        res.status(400).json({ error: 'phoneNumber is required.' });
        return;
      }

      const entry = DncRegistry.addNumber(tenantId, phoneNumber, reason, source);
      res.status(201).json({ success: true, entry });
    }
  );

  // DELETE /api/v1/tenants/:tenantId/campaigns/dnc/:phoneNumber - Remove from DNC
  router.delete(
    '/:tenantId/campaigns/dnc/:phoneNumber',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, phoneNumber } = req.params;
      const removed = DncRegistry.removeNumber(tenantId, decodeURIComponent(phoneNumber));

      if (!removed) {
        res.status(404).json({ error: 'Phone number was not found on DNC registry.' });
        return;
      }

      res.json({ success: true, message: 'Phone number removed from Do Not Call registry.' });
    }
  );

  return router;
}
