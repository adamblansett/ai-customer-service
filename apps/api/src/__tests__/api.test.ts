import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import { createApp } from '../app.js';
import type { Express } from 'express';

describe('API Server Integration & Security Suite', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let app: Express;
  let acmeAdminToken: string;
  let dentalAdminToken: string;
  let tenant1Id: string;
  let tenant2Id: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenant1Id = seed.tenant1Id;
    tenant2Id = seed.tenant2Id;
    app = createApp(db);

    // Login Acme Admin
    const acmeLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@acme-hvac.example.com', password: 'DevPassword123!' });

    expect(acmeLogin.status).toBe(200);
    acmeAdminToken = acmeLogin.body.token;

    // Login Dental Admin
    const dentalLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'dr.smith@summit-dental.example.com', password: 'DevPassword123!' });

    expect(dentalLogin.status).toBe(200);
    dentalAdminToken = dentalLogin.body.token;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('Health Endpoints', () => {
    it('returns status ok for liveness probe', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('returns ready status for readiness probe', async () => {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });
  });

  describe('Security & Multi-Tenant Authorization', () => {
    it('rejects unauthenticated requests to protected endpoints', async () => {
      const res = await request(app).get(`/api/v1/tenants/${tenant1Id}/settings`);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });

    it('strictly prevents cross-tenant access via URL parameter manipulation', async () => {
      // Acme Admin attempts to access Summit Dental settings
      const crossTenantRes = await request(app)
        .get(`/api/v1/tenants/${tenant2Id}/settings`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(crossTenantRes.status).toBe(403);
      expect(crossTenantRes.body.error).toContain('Cross-tenant access denied');
    });

    it('allows authorized tenant owner/admin access to their own tenant', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${tenant1Id}/settings`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.settings.businessName).toBe('Acme Heating & Air Conditioning');
    });
  });

  describe('Knowledge Base REST Operations', () => {
    it('allows ingestion, listing, and test search of documents', async () => {
      // 1. Ingest new document
      const ingestRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/knowledge`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          title: 'Heat Pump Warranty Guide',
          rawContent: 'All heat pump installations include a 10-year parts warranty and 2-year labor coverage.',
          sourceUri: 'kb://warranty/heat-pump.md',
        });

      expect(ingestRes.status).toBe(201);
      expect(ingestRes.body.document.id).toBeDefined();

      // 2. Test search
      const searchRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/knowledge/test-search`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({ query: 'heat pump warranty labor' });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.results.length).toBeGreaterThan(0);
      expect(searchRes.body.results[0].content).toContain('10-year parts warranty');
    });
  });

  describe('Telephony Inbound Webhooks', () => {
    it('handles Twilio inbound voice call webhook and returns TwiML XML', async () => {
      const res = await request(app)
        .post('/api/v1/voice/inbound')
        .query({ tenantId: tenant1Id })
        .send({
          CallSid: 'CA_test_webhook_123',
          From: '+15550101',
          To: '+15550100',
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      expect(res.text).toContain('<Response>');
      expect(res.text).toContain('<Gather input="speech"');
      expect(res.text).toContain('Acme Heating');
    });
  });

  describe('Website Public Chat Endpoint', () => {
    it('initializes public chat session and exchanges messages', async () => {
      // 1. Create public session
      const sessionRes = await request(app)
        .post('/api/v1/chat/public/session')
        .send({
          tenantSlug: 'acme-hvac',
          customerName: 'Website Visitor',
        });

      expect(sessionRes.status).toBe(201);
      expect(sessionRes.body.sessionId).toBeDefined();
      expect(sessionRes.body.businessName).toBe('Acme Heating & Air Conditioning');

      const sessionId = sessionRes.body.sessionId;

      // 2. Send customer message asking about pricing
      const messageRes = await request(app)
        .post('/api/v1/chat/public/message')
        .send({
          sessionId,
          content: 'What is the diagnostic fee for an AC check?',
        });

      expect(messageRes.status).toBe(200);
      expect(messageRes.body.reply.content).toContain('Diagnostic Fee: $89');
      expect(messageRes.body.sources.length).toBeGreaterThan(0);
    });
  });

  describe('Inbound SMS Webhook', () => {
    it('handles Twilio inbound SMS and returns TwiML message response', async () => {
      const res = await request(app)
        .post(`/api/v1/sms/inbound?tenantId=${tenant1Id}`)
        .send({
          MessageSid: 'SM_api_test_001',
          From: '+15551112233',
          To: '+18005550199',
          Body: 'What are your hours?',
        });

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('text/xml');
      expect(res.text).toContain('<Response>');
      expect(res.text).toContain('<Message>');
      expect(res.text).toContain('hours');
    });
  });
});

