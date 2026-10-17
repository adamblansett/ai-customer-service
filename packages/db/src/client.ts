import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import * as schema from './schema/index.js';

export type DatabaseInstance = ReturnType<typeof drizzlePg<typeof schema>> | ReturnType<typeof drizzlePglite<typeof schema>>;

let globalDb: DatabaseInstance | null = null;
let globalPgPool: pg.Pool | null = null;

export interface DatabaseOptions {
  connectionString?: string;
  useEmbedded?: boolean;
}

/**
 * Creates or retrieves the Drizzle database instance.
 * If DATABASE_URL is provided or useEmbedded is false, connects to PostgreSQL.
 * If useEmbedded is true or in test environments without DATABASE_URL, uses PGlite (in-memory/embedded Postgres).
 */
export async function getDatabase(options: DatabaseOptions = {}): Promise<DatabaseInstance> {
  if (globalDb && !options.useEmbedded) {
    return globalDb;
  }

  const connectionString = options.connectionString || process.env.DATABASE_URL;

  if (connectionString && !options.useEmbedded) {
    const pool = new pg.Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    globalPgPool = pool;
    const db = drizzlePg(pool, { schema });
    globalDb = db;
    return db;
  }

  // Fallback or explicit embedded mode (runs real Postgres in WASM for offline tests)
  const pglite = new PGlite();
  const db = drizzlePglite(pglite, { schema });

  // Initialize schema tables in PGlite
  await initializeSchemaInPglite(pglite);

  if (!options.useEmbedded) {
    globalDb = db;
  }
  return db;
}

/**
 * Executes DDL directly on PGlite instance to establish all tables for testing.
 */
export async function initializeSchemaInPglite(pglite: PGlite): Promise<void> {
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      system_role TEXT NOT NULL DEFAULT 'user',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenant_memberships (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'agent',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS business_settings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      business_name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      business_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
      fallback_phone TEXT,
      ai_greeting TEXT NOT NULL DEFAULT 'Hello! How can I help you today?',
      identify_as_ai BOOLEAN NOT NULL DEFAULT true,
      recording_consent_text TEXT DEFAULT 'This conversation may be recorded for quality assurance.',
      recording_consent_required BOOLEAN NOT NULL DEFAULT true,
      retention_days INTEGER NOT NULL DEFAULT 90,
      transfer_timeout_seconds INTEGER NOT NULL DEFAULT 30,
      after_hours_behavior TEXT NOT NULL DEFAULT 'callback',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS integration_credentials (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, provider)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT,
      phone_number TEXT,
      email TEXT,
      external_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      assigned_agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      escalation_state TEXT NOT NULL DEFAULT 'none',
      escalation_reason TEXT,
      summary TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL,
      sender_id TEXT,
      content TEXT NOT NULL,
      tool_calls JSONB DEFAULT '[]'::jsonb,
      tool_results JSONB DEFAULT '[]'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_uri TEXT,
      content_type TEXT NOT NULL DEFAULT 'text/markdown',
      raw_content TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'indexed',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      keywords TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS call_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      call_sid TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'twilio',
      from_number TEXT NOT NULL,
      to_number TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound',
      call_status TEXT NOT NULL DEFAULT 'ringing',
      recording_url TEXT,
      duration_seconds INTEGER DEFAULT 0,
      transfer_destination TEXT,
      transfer_status TEXT DEFAULT 'none',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS callback_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      phone_number TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      completed_at TIMESTAMPTZ,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS call_flows (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      start_node_id TEXT NOT NULL,
      nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
      version INTEGER NOT NULL DEFAULT 1,
      published BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dnc_entries (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'user_opt_out',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, phone_number)
    );

    CREATE TABLE IF NOT EXISTS voiceprints (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL,
      signature_hash TEXT NOT NULL,
      sample_count INTEGER NOT NULL DEFAULT 1,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_verified_at TIMESTAMPTZ,
      UNIQUE(tenant_id, customer_id)
    );
  `);
}

/**
 * Closes the database pool if active.
 */
export async function closeDatabase(): Promise<void> {
  if (globalPgPool) {
    await globalPgPool.end();
    globalPgPool = null;
  }
  globalDb = null;
}
