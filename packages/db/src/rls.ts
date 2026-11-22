import { sql } from 'drizzle-orm';
import type { DatabaseInstance } from './client.js';

export const TENANT_SCOPED_TABLES = [
  'tenant_memberships',
  'business_settings',
  'integration_credentials',
  'customers',
  'conversations',
  'messages',
  'knowledge_documents',
  'knowledge_chunks',
  'call_sessions',
  'callback_requests',
  'audit_events',
  'call_flows',
  'dnc_entries',
  'voiceprints',
  'appointments',
  'payment_transactions',
  'csat_surveys',
  'agent_shifts',
  'webhook_subscriptions',
  'knowledge_document_versions',
  'ab_experiments',
  'api_keys',
  'stripe_subscriptions',
  'external_orders',
  'external_tickets',
  'calendar_connections',
  'trace_spans',
] as const;

export interface RlsApplyOptions {
  /**
   * When true, rows are invisible unless app.current_tenant_id is explicitly set.
   * When false (default), enforces strict tenant isolation whenever app.current_tenant_id is set
   * via withTenantRlsContext(), while allowing system-level background maintenance when unset.
   */
  denyWhenUnset?: boolean;
}

export class TenantRlsManager {
  /**
   * Generates PostgreSQL DDL statements enabling Row-Level Security (RLS) + FORCE ROW LEVEL SECURITY
   * across all multi-tenant tables.
   */
  static generateRlsSql(options: RlsApplyOptions = {}): string {
    const denyWhenUnset = options.denyWhenUnset ?? false;
    const condition = denyWhenUnset
      ? `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')`
      : `(NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL OR tenant_id = current_setting('app.current_tenant_id', true))`;

    const statements: string[] = [
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cs_app_user') THEN CREATE ROLE cs_app_user NOLOGIN; END IF; END $$;`,
      `GRANT USAGE ON SCHEMA public TO cs_app_user;`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cs_app_user;`,
    ];

    for (const table of TENANT_SCOPED_TABLES) {
      statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      statements.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      statements.push(`DROP POLICY IF EXISTS tenant_isolation_policy ON ${table};`);
      statements.push(
        `CREATE POLICY tenant_isolation_policy ON ${table} FOR ALL USING (${condition}) WITH CHECK (${condition});`
      );
    }

    return statements.join('\n');
  }

  /**
   * Applies native PostgreSQL Row-Level Security policies to the active database instance.
   */
  static async applyPolicies(
    db: DatabaseInstance,
    options: RlsApplyOptions = {}
  ): Promise<{ tablesProtected: number }> {
    const ddl = this.generateRlsSql(options);
    const rawExec = (db as any).__rawExec as ((s: string) => Promise<void>) | undefined;
    if (rawExec) {
      await rawExec(ddl);
    } else {
      await db.execute(sql.raw(ddl));
    }
    return { tablesProtected: TENANT_SCOPED_TABLES.length };
  }
}

/**
 * Executes a callback inside a PostgreSQL transaction scoped to `tenantId` at the database engine level.
 * Even if application code omits a `WHERE tenant_id = ...` filter, PostgreSQL RLS blocks cross-tenant rows.
 */
export async function withTenantRlsContext<T>(
  db: DatabaseInstance,
  tenantId: string,
  callback: (tx: DatabaseInstance) => Promise<T>,
  options: { enforceNonSuperuserRole?: boolean } = {}
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    throw new Error('Invalid tenantId format for RLS session parameter.');
  }

  return (db as any).transaction(async (tx: DatabaseInstance) => {
    await tx.execute(sql.raw(`SET LOCAL app.current_tenant_id = '${tenantId}'`));
    if (options.enforceNonSuperuserRole !== false) {
      await tx.execute(sql.raw(`SET LOCAL ROLE cs_app_user`));
    }
    return callback(tx);
  });
}
