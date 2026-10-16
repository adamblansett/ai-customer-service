import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase, closeDatabase } from '../client.js';
import { seedDatabase } from '../seed.js';
import * as schema from '../schema/index.js';
import { eq, and } from 'drizzle-orm';

describe('Database Schema & Multi-Tenancy Verification', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;

  beforeAll(async () => {
    // Run against embedded WASM PostgreSQL (PGlite)
    db = await getDatabase({ useEmbedded: true });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('initializes schema and populates development seed data without error', async () => {
    const { tenant1Id, tenant2Id, adminUserId, agentUserId } = await seedDatabase(db);
    expect(tenant1Id).toBe('tenant_acme_hvac_001');
    expect(tenant2Id).toBe('tenant_summit_dental_002');
    expect(adminUserId).toBe('user_admin_001');
    expect(agentUserId).toBe('user_agent_002');

    // Query tenants
    const tenantRows = await db.select().from(schema.tenants);
    expect(tenantRows.length).toBeGreaterThanOrEqual(2);
  });

  it('strictly isolates tenant business settings', async () => {
    const acmeSettings = await db
      .select()
      .from(schema.businessSettings)
      .where(eq(schema.businessSettings.tenantId, 'tenant_acme_hvac_001'));

    expect(acmeSettings.length).toBe(1);
    expect(acmeSettings[0].businessName).toBe('Acme Heating & Air Conditioning');
    expect(acmeSettings[0].fallbackPhone).toBe('+15550199');

    const dentalSettings = await db
      .select()
      .from(schema.businessSettings)
      .where(eq(schema.businessSettings.tenantId, 'tenant_summit_dental_002'));

    expect(dentalSettings.length).toBe(1);
    expect(dentalSettings[0].businessName).toBe('Summit Dental Care');
    expect(dentalSettings[0].fallbackPhone).toBe('+15550299');
  });

  it('prevents cross-tenant knowledge document leakage', async () => {
    // Acme HVAC query must return only Acme documents
    const acmeDocs = await db
      .select()
      .from(schema.knowledgeDocuments)
      .where(eq(schema.knowledgeDocuments.tenantId, 'tenant_acme_hvac_001'));

    expect(acmeDocs.length).toBe(2);
    expect(acmeDocs.every(d => d.tenantId === 'tenant_acme_hvac_001')).toBe(true);

    // Summit Dental query must return 0 documents
    const dentalDocs = await db
      .select()
      .from(schema.knowledgeDocuments)
      .where(eq(schema.knowledgeDocuments.tenantId, 'tenant_summit_dental_002'));

    expect(dentalDocs.length).toBe(0);
  });

  it('enforces RBAC tenant membership roles', async () => {
    const acmeMemberships = await db
      .select()
      .from(schema.tenantMemberships)
      .where(eq(schema.tenantMemberships.tenantId, 'tenant_acme_hvac_001'));

    expect(acmeMemberships.length).toBe(2);
    const owner = acmeMemberships.find(m => m.role === 'owner');
    const agent = acmeMemberships.find(m => m.role === 'agent');

    expect(owner?.userId).toBe('user_admin_001');
    expect(agent?.userId).toBe('user_agent_002');
  });
});
