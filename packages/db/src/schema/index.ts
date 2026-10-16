import { pgTable, text, timestamp, boolean, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// -------------------------------------------------------------
// 1. Tenants Table
// -------------------------------------------------------------
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(), // UUID string
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('active'), // 'active', 'suspended', 'archived'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('tenants_slug_idx').on(table.slug),
]);

// -------------------------------------------------------------
// 2. Users Table
// -------------------------------------------------------------
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  systemRole: text('system_role').notNull().default('user'), // 'superadmin', 'user'
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('users_email_idx').on(table.email),
]);

// -------------------------------------------------------------
// 3. Tenant Memberships Table (Multi-tenant RBAC)
// -------------------------------------------------------------
export const tenantMemberships = pgTable('tenant_memberships', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('agent'), // 'owner', 'admin', 'agent'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('memberships_tenant_idx').on(table.tenantId),
  index('memberships_user_idx').on(table.userId),
  uniqueIndex('memberships_tenant_user_idx').on(table.tenantId, table.userId),
]);

// -------------------------------------------------------------
// 4. Business Settings & Operating Rules
// -------------------------------------------------------------
export const businessSettings = pgTable('business_settings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  businessName: text('business_name').notNull(),
  timezone: text('timezone').notNull().default('America/New_York'),
  // Business hours stored as structured JSON:
  // e.g. { monday: { open: "09:00", close: "17:00", closed: false }, ... }
  businessHours: jsonb('business_hours').notNull().default({}),
  fallbackPhone: text('fallback_phone'), // Destination E.164 for live agent transfers
  aiGreeting: text('ai_greeting').notNull().default('Hello! Thank you for calling. I am an automated customer service assistant. How can I help you today?'),
  identifyAsAi: boolean('identify_as_ai').notNull().default(true),
  recordingConsentText: text('recording_consent_text').default('This conversation may be recorded or monitored for quality assurance and training purposes.'),
  recordingConsentRequired: boolean('recording_consent_required').notNull().default(true),
  retentionDays: integer('retention_days').notNull().default(90),
  transferTimeoutSeconds: integer('transfer_timeout_seconds').notNull().default(30),
  afterHoursBehavior: text('after_hours_behavior').notNull().default('callback'), // 'voicemail', 'callback', 'ai_only'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('business_settings_tenant_idx').on(table.tenantId),
]);

// -------------------------------------------------------------
// 5. Integration Credentials (BYOK, AES-256-GCM encrypted)
// -------------------------------------------------------------
export const integrationCredentials = pgTable('integration_credentials', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'openai', 'anthropic', 'gemini', 'groq', 'twilio', 'sip'
  encryptedData: text('encrypted_data').notNull(), // hex ciphertext
  iv: text('iv').notNull(), // hex 12-byte initialization vector
  authTag: text('auth_tag').notNull(), // hex 16-byte authentication tag
  keyVersion: integer('key_version').notNull().default(1),
  status: text('status').notNull().default('active'), // 'active', 'revoked', 'invalid'
  metadata: jsonb('metadata').default({}), // non-sensitive fields: e.g. { maskedKey: "sk-...abc", accountSid: "AC..." }
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('creds_tenant_idx').on(table.tenantId),
  uniqueIndex('creds_tenant_provider_idx').on(table.tenantId, table.provider),
]);

// -------------------------------------------------------------
// 6. Customers Table
// -------------------------------------------------------------
export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name'),
  phoneNumber: text('phone_number'),
  email: text('email'),
  externalId: text('external_id'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('customers_tenant_idx').on(table.tenantId),
  index('customers_phone_idx').on(table.tenantId, table.phoneNumber),
  index('customers_email_idx').on(table.tenantId, table.email),
]);

// -------------------------------------------------------------
// 7. Conversations Table
// -------------------------------------------------------------
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  channel: text('channel').notNull(), // 'voice', 'chat', 'sms', 'email'
  status: text('status').notNull().default('active'), // 'active', 'waiting_agent', 'transferred', 'closed', 'failed', 'interrupted'
  assignedAgentId: text('assigned_agent_id').references(() => users.id, { onDelete: 'set null' }),
  escalationState: text('escalation_state').notNull().default('none'), // 'none', 'requested', 'in_progress', 'completed', 'failed'
  escalationReason: text('escalation_reason'),
  summary: text('summary'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (table) => [
  index('conv_tenant_idx').on(table.tenantId),
  index('conv_status_idx').on(table.tenantId, table.status),
  index('conv_created_idx').on(table.tenantId, table.createdAt),
]);

// -------------------------------------------------------------
// 8. Messages Table
// -------------------------------------------------------------
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderType: text('sender_type').notNull(), // 'customer', 'ai_agent', 'human_agent', 'system'
  senderId: text('sender_id'), // userId or caller phone or 'ai'
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls').default([]),
  toolResults: jsonb('tool_results').default([]),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('messages_conv_idx').on(table.conversationId),
  index('messages_tenant_idx').on(table.tenantId),
  index('messages_created_idx').on(table.conversationId, table.createdAt),
]);

// -------------------------------------------------------------
// 9. Knowledge Documents Table
// -------------------------------------------------------------
export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  sourceUri: text('source_uri'),
  contentType: text('content_type').notNull().default('text/markdown'), // 'text/markdown', 'text/plain'
  rawContent: text('raw_content').notNull(),
  chunkCount: integer('chunk_count').notNull().default(0),
  status: text('status').notNull().default('indexed'), // 'pending', 'indexed', 'failed'
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('docs_tenant_idx').on(table.tenantId),
  index('docs_status_idx').on(table.tenantId, table.status),
]);

// -------------------------------------------------------------
// 10. Knowledge Chunks Table (for indexed search & attribution)
// -------------------------------------------------------------
export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  tokenCount: integer('token_count').notNull().default(0),
  keywords: text('keywords').notNull(), // normalized search tokens for BM25/keyword retrieval
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('chunks_tenant_idx').on(table.tenantId),
  index('chunks_doc_idx').on(table.documentId),
]);

// -------------------------------------------------------------
// 11. Call Sessions Table (Telephony Call Lifecycle)
// -------------------------------------------------------------
export const callSessions = pgTable('call_sessions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  callSid: text('call_sid').notNull(),
  provider: text('provider').notNull().default('twilio'), // 'twilio', 'sip', 'simulator'
  fromNumber: text('from_number').notNull(),
  toNumber: text('to_number').notNull(),
  direction: text('direction').notNull().default('inbound'), // 'inbound', 'outbound'
  callStatus: text('call_status').notNull().default('ringing'), // 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer'
  recordingUrl: text('recording_url'),
  durationSeconds: integer('duration_seconds').default(0),
  transferDestination: text('transfer_destination'),
  transferStatus: text('transfer_status').default('none'), // 'none', 'initiated', 'connected', 'failed', 'no-answer'
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('calls_tenant_idx').on(table.tenantId),
  uniqueIndex('calls_sid_idx').on(table.callSid),
  index('calls_conv_idx').on(table.conversationId),
]);

// -------------------------------------------------------------
// 12. Callback Requests Table (Failed transfer fallback)
// -------------------------------------------------------------
export const callbackRequests = pgTable('callback_requests', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  phoneNumber: text('phone_number').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'), // 'pending', 'in_progress', 'completed', 'cancelled'
  assignedAgentId: text('assigned_agent_id').references(() => users.id, { onDelete: 'set null' }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  notes: text('notes'),
}, (table) => [
  index('callback_tenant_idx').on(table.tenantId),
  index('callback_status_idx').on(table.tenantId, table.status),
]);

// -------------------------------------------------------------
// 13. Audit Events Table (Tamper-evident operational logging)
// -------------------------------------------------------------
export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(), // 'user.login', 'credential.create', 'transfer.escalate', etc.
  resourceType: text('resource_type').notNull(), // 'conversation', 'document', 'credential', etc.
  resourceId: text('resource_id'),
  metadata: jsonb('metadata').default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('audit_tenant_idx').on(table.tenantId),
  index('audit_action_idx').on(table.tenantId, table.action),
  index('audit_created_idx').on(table.tenantId, table.createdAt),
]);
