import crypto from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';

export interface IssueApiKeyInput {
  tenantId: string;
  name: string;
  scopes: string[];
  createdBy?: string;
  expiresInDays?: number;
}

/**
 * Scoped M2M API Key Manager.
 * Raw API keys (`cs_live_...`) are returned once at creation and stored ONLY as SHA-256 hashes at rest.
 */
export class ApiKeyManager {
  constructor(private db: DatabaseInstance) {}

  public static hashApiKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
  }

  public async issueApiKey(input: IssueApiKeyInput) {
    const randomHex = crypto.randomBytes(24).toString('hex');
    const rawKey = `cs_live_${randomHex}`;
    const keyPrefix = rawKey.slice(0, 14);
    const keyHash = ApiKeyManager.hashApiKey(rawKey);
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;

    const [record] = await this.db
      .insert(schema.apiKeys)
      .values({
        id: `ak_${crypto.randomUUID()}`,
        tenantId: input.tenantId,
        name: input.name,
        keyPrefix,
        keyHash,
        scopes: input.scopes,
        createdBy: input.createdBy || null,
        expiresAt,
      })
      .returning();

    return {
      rawKey, // Returned ONLY once at creation
      apiKey: {
        id: record.id,
        tenantId: record.tenantId,
        name: record.name,
        keyPrefix: record.keyPrefix,
        scopes: record.scopes,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
    };
  }

  public async verifyApiKey(rawKey: string, requiredScope?: string) {
    if (!rawKey || !rawKey.startsWith('cs_live_')) {
      return { valid: false as const, reason: 'invalid_prefix' };
    }

    const keyHash = ApiKeyManager.hashApiKey(rawKey);
    const [record] = await this.db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.keyHash, keyHash), isNull(schema.apiKeys.revokedAt)));

    if (!record) {
      return { valid: false as const, reason: 'not_found_or_revoked' };
    }

    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      return { valid: false as const, reason: 'expired' };
    }

    const scopes = Array.isArray(record.scopes) ? (record.scopes as string[]) : [];
    if (requiredScope && !scopes.includes('*') && !scopes.includes(requiredScope)) {
      return { valid: false as const, reason: 'insufficient_scope' };
    }

    await this.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, record.id));

    return {
      valid: true as const,
      keyId: record.id,
      tenantId: record.tenantId,
      scopes,
    };
  }

  public async listApiKeys(tenantId: string) {
    const rows = await this.db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        keyPrefix: schema.apiKeys.keyPrefix,
        scopes: schema.apiKeys.scopes,
        expiresAt: schema.apiKeys.expiresAt,
        revokedAt: schema.apiKeys.revokedAt,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.tenantId, tenantId));

    return rows;
  }

  public async revokeApiKey(tenantId: string, keyId: string) {
    const [updated] = await this.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.tenantId, tenantId)))
      .returning();

    return Boolean(updated);
  }
}
