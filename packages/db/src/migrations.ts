import crypto from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from './client.js';
import * as schema from './schema/index.js';
import { TenantRlsManager } from './rls.js';

export interface SqlMigration {
  version: string;
  name: string;
  upSql: string;
  downSql: string;
}

export const BUILT_IN_MIGRATIONS: SqlMigration[] = [
  {
    version: '0001',
    name: 'passkeys_stripe_connectors_and_otel_traces',
    upSql: `
      CREATE TABLE IF NOT EXISTS passkey_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL UNIQUE,
        public_key_pem TEXT NOT NULL,
        algorithm TEXT NOT NULL DEFAULT 'ES256',
        sign_count INTEGER NOT NULL DEFAULT 0,
        device_name TEXT NOT NULL DEFAULT 'Security Key / Passkey',
        transports JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS stripe_subscriptions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'starter',
        status TEXT NOT NULL DEFAULT 'active',
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
        current_period_end TIMESTAMPTZ NOT NULL,
        last_synced_voice_minutes INTEGER NOT NULL DEFAULT 0,
        last_synced_ai_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS external_orders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'shopify',
        order_number TEXT NOT NULL,
        customer_email TEXT,
        customer_phone TEXT,
        fulfillment_status TEXT NOT NULL DEFAULT 'fulfilled',
        financial_status TEXT NOT NULL DEFAULT 'paid',
        total_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        tracking_number TEXT,
        tracking_url TEXT,
        return_eligible BOOLEAN NOT NULL DEFAULT true,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, order_number)
      );
      CREATE TABLE IF NOT EXISTS external_tickets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'zendesk',
        external_key TEXT NOT NULL,
        conversation_id TEXT,
        customer_phone TEXT,
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'open',
        assignee TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, external_key)
      );
      CREATE TABLE IF NOT EXISTS calendar_connections (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'google_calendar',
        calendar_id TEXT NOT NULL,
        technician_name TEXT NOT NULL,
        busy_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
        sync_token TEXT,
        status TEXT NOT NULL DEFAULT 'connected',
        last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS trace_spans (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversation_id TEXT,
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        parent_span_id TEXT,
        operation_name TEXT NOT NULL,
        stage TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ok',
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
    downSql: `
      DROP TABLE IF EXISTS trace_spans;
      DROP TABLE IF EXISTS calendar_connections;
      DROP TABLE IF EXISTS external_tickets;
      DROP TABLE IF EXISTS external_orders;
      DROP TABLE IF EXISTS stripe_subscriptions;
      DROP TABLE IF EXISTS passkey_credentials;
    `,
  },
  {
    version: '0002',
    name: 'enable_tenant_row_level_security',
    upSql: TenantRlsManager.generateRlsSql({ denyWhenUnset: false }),
    downSql: `SELECT 1;`,
  },
];

export class MigrationRunner {
  constructor(
    private db: DatabaseInstance,
    private migrations: SqlMigration[] = BUILT_IN_MIGRATIONS
  ) {}

  static computeChecksum(sqlText: string): string {
    return crypto.createHash('sha256').update(sqlText.trim()).digest('hex');
  }

  private async execRaw(sqlText: string): Promise<void> {
    const rawExec = (this.db as any).__rawExec as ((s: string) => Promise<void>) | undefined;
    if (rawExec) {
      await rawExec(sqlText);
    } else {
      await this.db.execute(sql.raw(sqlText));
    }
  }

  private async ensureLedgerTable(): Promise<void> {
    await this.execRaw(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async status(): Promise<{
    applied: Array<{ version: string; name: string; checksum: string; appliedAt: Date }>;
    pending: Array<{ version: string; name: string }>;
  }> {
    await this.ensureLedgerTable();
    const applied = await this.db
      .select()
      .from(schema.schemaMigrations)
      .orderBy(asc(schema.schemaMigrations.version));

    const appliedMap = new Map(applied.map((row) => [row.version, row]));
    const pending: Array<{ version: string; name: string }> = [];

    for (const m of this.migrations) {
      const existing = appliedMap.get(m.version);
      if (!existing) {
        pending.push({ version: m.version, name: m.name });
      } else {
        const expectedChecksum = MigrationRunner.computeChecksum(m.upSql);
        if (existing.checksum !== expectedChecksum) {
          throw new Error(
            `MigrationChecksumMismatchError: Migration ${m.version} (${m.name}) checksum changed after execution.`
          );
        }
      }
    }

    return { applied, pending };
  }

  async migrateUp(): Promise<{ appliedVersions: string[] }> {
    const { pending } = await this.status();
    const pendingSet = new Set(pending.map((p) => p.version));
    const appliedVersions: string[] = [];

    for (const migration of this.migrations) {
      if (!pendingSet.has(migration.version)) continue;

      await this.execRaw(migration.upSql);
      await this.db.insert(schema.schemaMigrations).values({
        version: migration.version,
        name: migration.name,
        checksum: MigrationRunner.computeChecksum(migration.upSql),
      });
      appliedVersions.push(migration.version);
    }

    return { appliedVersions };
  }

  async rollbackLast(): Promise<{ rolledBackVersion: string | null }> {
    const { applied } = await this.status();
    if (applied.length === 0) {
      return { rolledBackVersion: null };
    }

    const latest = applied[applied.length - 1];
    const definition = this.migrations.find((m) => m.version === latest.version);
    if (!definition) {
      throw new Error(`Migration definition not found for version ${latest.version}`);
    }

    await this.execRaw(definition.downSql);
    await this.db
      .delete(schema.schemaMigrations)
      .where(eq(schema.schemaMigrations.version, latest.version));

    return { rolledBackVersion: latest.version };
  }
}
