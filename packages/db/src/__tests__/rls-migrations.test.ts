import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getDatabase,
  closeDatabase,
  seedDatabase,
  MigrationRunner,
  TenantRlsManager,
  withTenantRlsContext,
  customers,
} from '../index.js';

describe('PostgreSQL Row-Level Security (RLS) & Versioned Migration Runner', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let tenant1Id: string;
  let tenant2Id: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seeded = await seedDatabase(db);
    tenant1Id = seeded.tenant1Id;
    tenant2Id = seeded.tenant2Id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('tracks SQL migrations idempotently with SHA-256 checksum verification and supports rollback', async () => {
    const runner = new MigrationRunner(db);
    const initial = await runner.status();
    expect(initial.pending.length).toBeGreaterThanOrEqual(2);

    const upResult = await runner.migrateUp();
    expect(upResult.appliedVersions).toContain('0001');
    expect(upResult.appliedVersions).toContain('0002');

    // Second run is a clean no-op
    const secondRun = await runner.migrateUp();
    expect(secondRun.appliedVersions).toHaveLength(0);

    // Rollback latest migration and re-apply
    const rolledBack = await runner.rollbackLast();
    expect(rolledBack.rolledBackVersion).toBe('0002');

    const reapplied = await runner.migrateUp();
    expect(reapplied.appliedVersions).toEqual(['0002']);
  });

  it('enforces PostgreSQL engine-level FORCE ROW LEVEL SECURITY even without WHERE tenant_id filter', async () => {
    const applied = await TenantRlsManager.applyPolicies(db, { denyWhenUnset: false });
    expect(applied.tablesProtected).toBe(27);

    // Seed one customer in Tenant 1 and one in Tenant 2
    await db.insert(customers).values([
      {
        id: 'cust_rls_t1',
        tenantId: tenant1Id,
        name: 'Tenant 1 Exclusive Customer',
        phoneNumber: '+15551110001',
      },
      {
        id: 'cust_rls_t2',
        tenantId: tenant2Id,
        name: 'Tenant 2 Exclusive Customer',
        phoneNumber: '+15552220002',
      },
    ]);

    // Unfiltered SELECT * FROM customers inside Tenant 1 RLS context MUST NEVER return Tenant 2 rows!
    const tenant1Visible = await withTenantRlsContext(db, tenant1Id, async (tx) => {
      return tx.select().from(customers);
    });
    expect(tenant1Visible.length).toBeGreaterThan(0);
    expect(tenant1Visible.every((c) => c.tenantId === tenant1Id)).toBe(true);
    expect(tenant1Visible.some((c) => c.id === 'cust_rls_t2')).toBe(false);

    // Unfiltered SELECT * FROM customers inside Tenant 2 RLS context MUST NEVER return Tenant 1 rows!
    const tenant2Visible = await withTenantRlsContext(db, tenant2Id, async (tx) => {
      return tx.select().from(customers);
    });
    expect(tenant2Visible.length).toBeGreaterThan(0);
    expect(tenant2Visible.every((c) => c.tenantId === tenant2Id)).toBe(true);
    expect(tenant2Visible.some((c) => c.id === 'cust_rls_t1')).toBe(false);

    // Attempting to INSERT a row for Tenant 2 while scoped to Tenant 1 must be rejected by Postgres RLS WITH CHECK
    await expect(
      withTenantRlsContext(db, tenant1Id, async (tx) => {
        await tx.insert(customers).values({
          id: 'cust_rls_cross_write_violation',
          tenantId: tenant2Id,
          name: 'Spoofed Cross-Tenant Insert',
        });
      })
    ).rejects.toThrow();
  });
});
