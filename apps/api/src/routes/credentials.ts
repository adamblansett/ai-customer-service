import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import {
  encryptCredential,
  maskSecret,
  TenantAiResolver,
  BUILT_IN_OPEN_WEIGHT_MODELS,
  type BuiltInModelProfileId,
} from '@customer-service/core';
import crypto from 'node:crypto';

export function createCredentialsRouter(db: DatabaseInstance): Router {
  const router = Router();
  const aiResolver = new TenantAiResolver(db);

  // GET /api/v1/tenants/:tenantId/ai/builtin - Get Built-In Open-Weights AI status & active resolution
  router.get(
    '/:tenantId/ai/builtin',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const resolved = await aiResolver.resolveForTenant(tenantId);
      const selectedProfileId = TenantAiResolver.getTenantBuiltInProfile(tenantId);
      const selectedProfile =
        BUILT_IN_OPEN_WEIGHT_MODELS[selectedProfileId] ||
        BUILT_IN_OPEN_WEIGHT_MODELS['qwen2.5:7b-instruct'];

      res.json({
        activeMode: resolved.mode,
        activeProvider: resolved.providerName,
        activeModel: resolved.model,
        license: resolved.license,
        selectedBuiltInProfile: selectedProfile,
        availableProfiles: Object.values(BUILT_IN_OPEN_WEIGHT_MODELS),
      });
    }
  );

  // POST /api/v1/tenants/:tenantId/ai/builtin/profile - Select Built-In Open-Weights Preset (Qwen, Llama, Mistral)
  router.post(
    '/:tenantId/ai/builtin/profile',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { profileId } = req.body as { profileId?: BuiltInModelProfileId };

      if (!profileId || !BUILT_IN_OPEN_WEIGHT_MODELS[profileId]) {
        res.status(400).json({
          error:
            "Invalid profileId. Must be one of: 'qwen2.5:7b-instruct', 'qwen2.5:3b', 'llama3.1:8b', 'llama3.2:3b', or 'mistral-small:24b'.",
        });
        return;
      }

      TenantAiResolver.setTenantBuiltInProfile(tenantId, profileId);
      const resolved = await aiResolver.resolveForTenant(tenantId);

      res.json({
        success: true,
        selectedBuiltInProfile: BUILT_IN_OPEN_WEIGHT_MODELS[profileId],
        activeMode: resolved.mode,
        activeModel: resolved.model,
      });
    }
  );

  // GET /api/v1/tenants/:tenantId/credentials - List configured integrations
  router.get(
    '/:tenantId/credentials',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;

      const rows = await db
        .select({
          id: schema.integrationCredentials.id,
          provider: schema.integrationCredentials.provider,
          status: schema.integrationCredentials.status,
          metadata: schema.integrationCredentials.metadata,
          updatedAt: schema.integrationCredentials.updatedAt,
        })
        .from(schema.integrationCredentials)
        .where(eq(schema.integrationCredentials.tenantId, tenantId));

      res.json({ credentials: rows });
    }
  );

  // POST /api/v1/tenants/:tenantId/credentials - Save/update BYOK credential
  router.post(
    '/:tenantId/credentials',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const tenantId = req.params.tenantId;
      const { provider, apiKey, accountSid, authToken, sipHost, sipUser, sipPassword } = req.body;

      if (!provider) {
        res.status(400).json({ error: 'Provider is required.' });
        return;
      }

      let payloadToEncrypt = '';
      let metadata: Record<string, any> = {};

      if (['openai', 'anthropic', 'gemini', 'groq'].includes(provider)) {
        if (!apiKey) {
          res.status(400).json({ error: `API key is required for provider '${provider}'.` });
          return;
        }
        payloadToEncrypt = JSON.stringify({ apiKey });
        metadata = { maskedKey: maskSecret(apiKey), configuredAt: new Date().toISOString() };
      } else if (provider === 'twilio') {
        if (!accountSid || !authToken) {
          res.status(400).json({ error: 'Account SID and Auth Token are required for Twilio.' });
          return;
        }
        payloadToEncrypt = JSON.stringify({ accountSid, authToken });
        metadata = { maskedSid: maskSecret(accountSid), maskedToken: maskSecret(authToken) };
      } else if (provider === 'sip') {
        payloadToEncrypt = JSON.stringify({ sipHost, sipUser, sipPassword });
        metadata = { sipHost, sipUser };
      }

      const encrypted = encryptCredential(payloadToEncrypt);

      // Check if existing
      const [existing] = await db
        .select()
        .from(schema.integrationCredentials)
        .where(
          and(
            eq(schema.integrationCredentials.tenantId, tenantId),
            eq(schema.integrationCredentials.provider, provider)
          )
        );

      let record;
      if (existing) {
        [record] = await db
          .update(schema.integrationCredentials)
          .set({
            encryptedData: encrypted.encryptedData,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyVersion: encrypted.keyVersion,
            status: 'active',
            metadata,
            updatedAt: new Date(),
          })
          .where(eq(schema.integrationCredentials.id, existing.id))
          .returning();
      } else {
        [record] = await db
          .insert(schema.integrationCredentials)
          .values({
            id: `cred_${crypto.randomUUID()}`,
            tenantId,
            provider,
            encryptedData: encrypted.encryptedData,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyVersion: encrypted.keyVersion,
            status: 'active',
            metadata,
          })
          .returning();
      }

      res.status(201).json({
        success: true,
        credential: {
          id: record.id,
          provider: record.provider,
          status: record.status,
          metadata: record.metadata,
          updatedAt: record.updatedAt,
        },
      });
    }
  );

  // DELETE /api/v1/tenants/:tenantId/credentials/:provider
  router.delete(
    '/:tenantId/credentials/:provider',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, provider } = req.params;

      await db
        .delete(schema.integrationCredentials)
        .where(
          and(
            eq(schema.integrationCredentials.tenantId, tenantId),
            eq(schema.integrationCredentials.provider, provider)
          )
        );

      res.json({ success: true, message: `Credential for '${provider}' deleted.` });
    }
  );

  return router;
}
