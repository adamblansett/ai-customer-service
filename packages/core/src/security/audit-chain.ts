import crypto from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Cryptographic SHA-256 Hash-Chained Audit Log Manager (SOC2 / HIPAA Tamper-Evidence).
 */
export class AuditChainManager {
  constructor(private db: DatabaseInstance) {}

  public static computeChainHash(params: {
    prevHash: string;
    tenantId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    payloadJson: string;
  }): string {
    const canonical = `${params.prevHash}|${params.tenantId}|${params.action}|${params.resourceType}|${params.resourceId}|${params.payloadJson}`;
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  public async appendChainedAuditEvent(params: {
    tenantId: string;
    userId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
  }) {
    const existing = await this.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.tenantId, params.tenantId))
      .orderBy(asc(schema.auditEvents.createdAt));

    let prevHash = GENESIS_HASH;
    for (let i = existing.length - 1; i >= 0; i--) {
      const meta = existing[i].metadata as Record<string, any> | null;
      if (meta?.chainEntryHash) {
        prevHash = meta.chainEntryHash;
        break;
      }
    }

    const resourceId = params.resourceId || 'global';
    const payloadJson = JSON.stringify(params.details || {});
    const chainEntryHash = AuditChainManager.computeChainHash({
      prevHash,
      tenantId: params.tenantId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId,
      payloadJson,
    });

    const [created] = await this.db
      .insert(schema.auditEvents)
      .values({
        id: `audit_${crypto.randomUUID()}`,
        tenantId: params.tenantId,
        userId: params.userId || null,
        action: params.action,
        resourceType: params.resourceType,
        resourceId,
        ipAddress: params.ipAddress || null,
        metadata: {
          ...(params.details || {}),
          chainPrevHash: prevHash,
          chainEntryHash,
          chainPayloadJson: payloadJson,
        },
      })
      .returning();

    return {
      event: created,
      prevHash,
      entryHash: chainEntryHash,
    };
  }

  /**
   * Walks all chained audit events for a tenant and verifies cryptographic link integrity.
   */
  public async verifyTenantAuditChain(tenantId: string) {
    const rows = await this.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.tenantId, tenantId))
      .orderBy(asc(schema.auditEvents.createdAt));

    let expectedPrevHash = GENESIS_HASH;
    let verifiedCount = 0;

    for (const row of rows) {
      const meta = (row.metadata || {}) as Record<string, any>;
      if (!meta.chainEntryHash) {
        // Legacy unchained audit event prior to chain initialization
        continue;
      }

      if (meta.chainPrevHash !== expectedPrevHash) {
        return {
          intact: false,
          verifiedCount,
          tamperedEventId: row.id,
          reason: 'prev_hash_mismatch',
        };
      }

      const recomputed = AuditChainManager.computeChainHash({
        prevHash: meta.chainPrevHash,
        tenantId: row.tenantId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId || 'global',
        payloadJson: meta.chainPayloadJson ?? '{}',
      });

      if (recomputed !== meta.chainEntryHash) {
        return {
          intact: false,
          verifiedCount,
          tamperedEventId: row.id,
          reason: 'entry_hash_tampered',
        };
      }

      expectedPrevHash = meta.chainEntryHash;
      verifiedCount += 1;
    }

    return {
      intact: true,
      verifiedCount,
      headHash: expectedPrevHash,
      tamperedEventId: null,
    };
  }
}
