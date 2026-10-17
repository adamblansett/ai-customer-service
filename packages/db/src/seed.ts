import { DatabaseInstance } from './client.js';
import * as schema from './schema/index.js';
import bcrypt from 'bcryptjs';

export async function seedDatabase(db: DatabaseInstance): Promise<{
  tenant1Id: string;
  tenant2Id: string;
  adminUserId: string;
  agentUserId: string;
}> {
  const tenant1Id = 'tenant_acme_hvac_001';
  const tenant2Id = 'tenant_summit_dental_002';
  const adminUserId = 'user_admin_001';
  const agentUserId = 'user_agent_002';
  const otherTenantAdminId = 'user_dental_admin_003';

  // Salt and hash development passwords
  const passwordHash = await bcrypt.hash('DevPassword123!', 10);

  // 1. Create Tenants
  await db.insert(schema.tenants).values([
    {
      id: tenant1Id,
      name: 'Acme Heating & Air Conditioning',
      slug: 'acme-hvac',
      status: 'active',
    },
    {
      id: tenant2Id,
      name: 'Summit Dental Care',
      slug: 'summit-dental',
      status: 'active',
    },
  ]).onConflictDoNothing();

  // 2. Create Users
  await db.insert(schema.users).values([
    {
      id: adminUserId,
      email: 'admin@acme-hvac.example.com',
      passwordHash,
      name: 'Alice Henderson (Admin)',
      systemRole: 'user',
      isActive: true,
    },
    {
      id: agentUserId,
      email: 'sarah.agent@acme-hvac.example.com',
      passwordHash,
      name: 'Sarah Connor (Support Agent)',
      systemRole: 'user',
      isActive: true,
    },
    {
      id: otherTenantAdminId,
      email: 'dr.smith@summit-dental.example.com',
      passwordHash,
      name: 'Dr. Robert Smith (Dental Admin)',
      systemRole: 'user',
      isActive: true,
    },
  ]).onConflictDoNothing();

  // 3. Tenant Memberships
  await db.insert(schema.tenantMemberships).values([
    {
      id: 'mem_acme_admin',
      tenantId: tenant1Id,
      userId: adminUserId,
      role: 'owner',
    },
    {
      id: 'mem_acme_agent',
      tenantId: tenant1Id,
      userId: agentUserId,
      role: 'agent',
    },
    {
      id: 'mem_dental_admin',
      tenantId: tenant2Id,
      userId: otherTenantAdminId,
      role: 'owner',
    },
  ]).onConflictDoNothing();

  // 4. Business Settings for Acme HVAC
  await db.insert(schema.businessSettings).values([
    {
      id: 'settings_acme_001',
      tenantId: tenant1Id,
      businessName: 'Acme Heating & Air Conditioning',
      timezone: 'America/New_York',
      businessHours: {
        monday: { open: '08:00', close: '18:00', closed: false },
        tuesday: { open: '08:00', close: '18:00', closed: false },
        wednesday: { open: '08:00', close: '18:00', closed: false },
        thursday: { open: '08:00', close: '18:00', closed: false },
        friday: { open: '08:00', close: '18:00', closed: false },
        saturday: { open: '09:00', close: '14:00', closed: false },
        sunday: { open: '00:00', close: '00:00', closed: true },
      },
      fallbackPhone: '+15550199',
      aiGreeting: 'Hello! Thank you for calling Acme Heating and Air Conditioning. I am an automated assistant. How can I help with your HVAC service today?',
      identifyAsAi: true,
      recordingConsentText: 'Please note that calls are recorded for quality assurance.',
      recordingConsentRequired: true,
      retentionDays: 90,
      transferTimeoutSeconds: 30,
      afterHoursBehavior: 'callback',
    },
    {
      id: 'settings_dental_002',
      tenantId: tenant2Id,
      businessName: 'Summit Dental Care',
      timezone: 'America/New_York',
      businessHours: {
        monday: { open: '08:30', close: '16:30', closed: false },
        tuesday: { open: '08:30', close: '16:30', closed: false },
        wednesday: { open: '08:30', close: '16:30', closed: false },
        thursday: { open: '08:30', close: '16:30', closed: false },
        friday: { open: '08:30', close: '14:00', closed: false },
        saturday: { open: '00:00', close: '00:00', closed: true },
        sunday: { open: '00:00', close: '00:00', closed: true },
      },
      fallbackPhone: '+15550299',
      aiGreeting: 'Welcome to Summit Dental Care. I am an AI scheduling assistant. How may I assist you?',
      identifyAsAi: true,
      recordingConsentText: 'Calls may be monitored for training.',
      recordingConsentRequired: true,
      retentionDays: 180,
      transferTimeoutSeconds: 25,
      afterHoursBehavior: 'voicemail',
    },
  ]).onConflictDoNothing();

  // 5. Sample Knowledge Documents for Acme HVAC
  const doc1Id = 'doc_acme_hours_001';
  const doc2Id = 'doc_acme_pricing_002';

  await db.insert(schema.knowledgeDocuments).values([
    {
      id: doc1Id,
      tenantId: tenant1Id,
      title: 'Business Hours and Emergency Service Policy',
      sourceUri: 'kb://policies/hours.md',
      contentType: 'text/markdown',
      rawContent: `# Business Hours & Emergency Service
Standard operating hours are Monday through Friday from 8:00 AM to 6:00 PM Eastern, and Saturday from 9:00 AM to 2:00 PM. We are closed on Sunday for standard service.
For emergency heating failure in freezing temperatures (below 32°F / 0°C), emergency dispatch is available 24/7 by speaking to an on-call technician.`,
      chunkCount: 2,
      status: 'indexed',
    },
    {
      id: doc2Id,
      tenantId: tenant1Id,
      title: 'Standard Service Pricing and Diagnostic Fees',
      sourceUri: 'kb://pricing/standard-rates.md',
      contentType: 'text/markdown',
      rawContent: `# Pricing and Diagnostic Fees
- Diagnostic Fee: $89 (applied toward total repair cost if service is performed).
- Annual AC Tune-Up: $129 per unit.
- Furnace Maintenance Check: $119 per unit.
- Emergency After-Hours Dispatch Fee: $149 flat diagnostic fee.
We do not offer phone quotes for complex compressor or refrigerant replacements without an on-site technician diagnostic.`,
      chunkCount: 2,
      status: 'indexed',
    },
  ]).onConflictDoNothing();

  // 6. Chunks for Acme HVAC documents
  await db.insert(schema.knowledgeChunks).values([
    {
      id: 'chunk_acme_hours_1',
      tenantId: tenant1Id,
      documentId: doc1Id,
      chunkIndex: 0,
      content: 'Standard operating hours are Monday through Friday from 8:00 AM to 6:00 PM Eastern, and Saturday from 9:00 AM to 2:00 PM. Closed on Sunday.',
      keywords: 'hours standard operating monday friday saturday sunday open close schedule eastern',
      tokenCount: 30,
    },
    {
      id: 'chunk_acme_hours_2',
      tenantId: tenant1Id,
      documentId: doc1Id,
      chunkIndex: 1,
      content: 'For emergency heating failure in freezing temperatures (below 32°F / 0°C), emergency dispatch is available 24/7 by speaking to an on-call technician.',
      keywords: 'emergency heating failure freeze freezing temperatures 24/7 technician dispatch cold',
      tokenCount: 25,
    },
    {
      id: 'chunk_acme_pricing_1',
      tenantId: tenant1Id,
      documentId: doc2Id,
      chunkIndex: 0,
      content: 'Diagnostic Fee: $89 (applied toward repair cost). Annual AC Tune-Up: $129 per unit. Furnace Maintenance Check: $119 per unit.',
      keywords: 'pricing diagnostic fee 89 ac tune-up 129 furnace maintenance check 119 cost price',
      tokenCount: 28,
    },
    {
      id: 'chunk_acme_pricing_2',
      tenantId: tenant1Id,
      documentId: doc2Id,
      chunkIndex: 1,
      content: 'Emergency After-Hours Dispatch Fee: $149 flat diagnostic fee. No phone quotes for compressor or refrigerant replacements without on-site diagnostic.',
      keywords: 'emergency after-hours fee 149 dispatch diagnostic quote compressor refrigerant replacement',
      tokenCount: 24,
    },
  ]).onConflictDoNothing();

  // 7. Sample Customer for Acme HVAC
  await db.insert(schema.customers).values([
    {
      id: 'cust_john_doe_001',
      tenantId: tenant1Id,
      name: 'John Doe',
      phoneNumber: '+15550101',
      email: 'john.doe@example.com',
      metadata: { address: '123 Maple Street, Springfield' },
    },
  ]).onConflictDoNothing();

  // 8. Default Call Flow for Acme HVAC
  await db.insert(schema.callFlows).values([
    {
      id: 'flow_acme_default_001',
      tenantId: tenant1Id,
      name: 'Main Inbound IVR & Emergency Triage',
      description: 'Default DAG routing flow for Acme Heating & Cooling',
      startNodeId: 'node_welcome',
      nodes: [
        {
          id: 'node_welcome',
          type: 'greeting',
          label: 'Welcome Greeting',
          promptText: 'Thank you for calling Acme Heating and Cooling.',
          nextNodeId: 'node_menu',
        },
        {
          id: 'node_menu',
          type: 'dtmf_menu',
          label: 'Main Department Menu',
          promptText: 'Press 1 for Sales, Press 2 for Emergency, or stay on the line for AI Assistant.',
          branches: [
            { condition: '1', targetNodeId: 'node_sales' },
            { condition: '2', targetNodeId: 'node_dispatch' },
          ],
          defaultTargetNodeId: 'node_ai',
        },
        {
          id: 'node_sales',
          type: 'transfer_queue',
          label: 'Sales Queue',
          queueId: 'sales',
        },
        {
          id: 'node_dispatch',
          type: 'transfer_queue',
          label: 'Emergency Dispatch',
          queueId: 'emergency_dispatch',
        },
        {
          id: 'node_ai',
          type: 'ai_voice',
          label: 'AI Conversational Assistant',
          nextNodeId: 'node_hangup',
        },
        {
          id: 'node_hangup',
          type: 'hangup',
          label: 'Friendly Hangup',
          promptText: 'Thank you for calling Acme. Goodbye!',
        },
      ],
      version: 1,
      published: true,
    },
  ]).onConflictDoNothing();

  return { tenant1Id, tenant2Id, adminUserId, agentUserId };
}

