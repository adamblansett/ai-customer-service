import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import {
  VoiceBiometricsEngine,
  CallRiskScorer,
  SalesforceCrmConnector,
  HubspotCrmConnector,
} from '@customer-service/core';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';

export function createEnterpriseRouter(db: DatabaseInstance): Router {
  const router = Router();
  const biometrics = new VoiceBiometricsEngine();

  // POST /api/v1/tenants/:tenantId/security/biometrics/enroll - Enroll caller voiceprint
  router.post(
    '/:tenantId/security/biometrics/enroll',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { customerId, audioSample } = req.body;

      if (!customerId || !audioSample) {
        res.status(400).json({ error: 'customerId and audioSample are required.' });
        return;
      }

      const record = biometrics.enrollVoiceprint(`${tenantId}:${customerId}`, audioSample);

      // Persist in PostgreSQL voiceprints table
      const [existing] = await db
        .select()
        .from(schema.voiceprints)
        .where(
          and(
            eq(schema.voiceprints.tenantId, tenantId),
            eq(schema.voiceprints.customerId, customerId)
          )
        );

      if (existing) {
        await db
          .update(schema.voiceprints)
          .set({
            signatureHash: record.fingerprintHash,
            sampleCount: existing.sampleCount + 1,
            enrolledAt: new Date(),
          })
          .where(eq(schema.voiceprints.id, existing.id));
      } else {
        await db.insert(schema.voiceprints).values({
          id: `vp_${randomUUID()}`,
          tenantId,
          customerId,
          signatureHash: record.fingerprintHash,
          sampleCount: 1,
        });
      }

      res.status(201).json({
        enrolled: true,
        customerId,
        fingerprintHash: record.fingerprintHash,
        enrolledAt: record.enrolledAt,
      });
    }
  );

  // POST /api/v1/tenants/:tenantId/security/biometrics/verify - Verify caller voiceprint
  router.post(
    '/:tenantId/security/biometrics/verify',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { customerId, audioSample } = req.body;

      if (!customerId || !audioSample) {
        res.status(400).json({ error: 'customerId and audioSample are required.' });
        return;
      }

      // Check PostgreSQL voiceprints table
      const [dbVp] = await db
        .select()
        .from(schema.voiceprints)
        .where(
          and(
            eq(schema.voiceprints.tenantId, tenantId),
            eq(schema.voiceprints.customerId, customerId)
          )
        );

      if (!dbVp) {
        res.status(200).json({
          verified: false,
          confidenceScore: 0,
          matchThreshold: 0.85,
          customerId,
          reason: 'No enrolled voiceprint found for customer.',
        });
        return;
      }

      const currentHash = biometrics.generateFingerprint(audioSample);
      let matchingChars = 0;
      const len = Math.min(dbVp.signatureHash.length, currentHash.length);
      for (let i = 0; i < len; i++) {
        if (dbVp.signatureHash[i] === currentHash[i]) {
          matchingChars++;
        }
      }

      const confidenceScore = Number((matchingChars / len).toFixed(2));
      const verified = confidenceScore >= 0.85;

      if (verified) {
        await db
          .update(schema.voiceprints)
          .set({ lastVerifiedAt: new Date() })
          .where(eq(schema.voiceprints.id, dbVp.id));
      }

      res.status(200).json({
        verified,
        confidenceScore,
        matchThreshold: 0.85,
        customerId,
      });
    }
  );

  // POST /api/v1/tenants/:tenantId/security/risk-score - Evaluate inbound call fraud risk
  router.post(
    '/:tenantId/security/risk-score',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { fromNumber, toNumber, lineType, carrier, recentCallCountLastHour, isAnonymous } = req.body;

      const assessment = CallRiskScorer.evaluateCallRisk({
        fromNumber: fromNumber || 'Anonymous',
        toNumber: toNumber || '+15550199',
        lineType,
        carrier,
        recentCallCountLastHour,
        isAnonymous,
      });

      res.status(200).json({ assessment });
    }
  );

  // POST /api/v1/tenants/:tenantId/crm/sync - Synchronize contact and call activity with Salesforce or HubSpot
  router.post(
    '/:tenantId/crm/sync',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { provider, contact, callActivity } = req.body;

      if (!provider || !['salesforce', 'hubspot'].includes(provider)) {
        res.status(400).json({ error: 'provider must be salesforce or hubspot.' });
        return;
      }

      // Deterministic mock fetch when live CRM credentials are not supplied
      const mockFetch: typeof fetch = async (input: any) => {
        const url = String(input);
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            id: url.includes('Task') || url.includes('calls')
              ? `${provider}_activity_${Date.now()}`
              : `${provider}_contact_${Date.now()}`,
            success: true,
          }),
        } as any;
      };

      const connector =
        provider === 'salesforce'
          ? new SalesforceCrmConnector({
              instanceUrl: process.env.SALESFORCE_INSTANCE_URL || 'https://acme.my.salesforce.com',
              accessToken: process.env.SALESFORCE_ACCESS_TOKEN || 'offline_token',
              fetchFn: process.env.SALESFORCE_ACCESS_TOKEN ? undefined : mockFetch,
            })
          : new HubspotCrmConnector({
              accessToken: process.env.HUBSPOT_ACCESS_TOKEN || 'offline_token',
              fetchFn: process.env.HUBSPOT_ACCESS_TOKEN ? undefined : mockFetch,
            });

      const results: Record<string, any> = { provider };

      if (contact) {
        results.contactSync = await connector.upsertContact(contact);
      }

      if (callActivity) {
        results.activitySync = await connector.logCallActivity({
          ...callActivity,
          timestamp: callActivity.timestamp ? new Date(callActivity.timestamp) : new Date(),
        });
      }

      res.status(200).json(results);
    }
  );

  return router;
}
