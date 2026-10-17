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

  describe('Inbound Email Webhook', () => {
    it('handles inbound email, creates conversation, and returns reply payload', async () => {
      const res = await request(app)
        .post(`/api/v1/email/inbound?tenantId=${tenant1Id}`)
        .send({
          From: 'customer@example.com',
          To: 'support@acme-hvac.example.com',
          Subject: 'Heating inquiry',
          TextBody: 'Do you offer emergency heating support?',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('delivered');
      expect(res.body.conversationId).toBeDefined();
      expect(res.body.reply.subject).toBe('Re: Heating inquiry');
      expect(res.body.reply.text).toBeDefined();
    });
  });

  describe('WhatsApp Webhook Handshake & Messaging', () => {
    it('verifies webhook subscription handshake challenge', async () => {
      const res = await request(app)
        .get('/api/v1/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'customer_service_wa_verify_token',
          'hub.challenge': 'CHALLENGE_ACCEPTED_99',
        });

      expect(res.status).toBe(200);
      expect(res.text).toBe('CHALLENGE_ACCEPTED_99');
    });

    it('processes inbound WhatsApp message and returns response status', async () => {
      const res = await request(app)
        .post(`/api/v1/whatsapp/webhook?tenantId=${tenant1Id}`)
        .send({
          object: 'whatsapp_business_account',
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: '15559876543',
                        id: 'wamid_test_999',
                        text: { body: 'What are your weekend hours?' },
                        type: 'text',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');
      expect(res.body.processed).toBe(1);
      expect(res.body.replies[0].responsePayload.messaging_product).toBe('whatsapp');
    });
  });

  describe('Outbound Campaigns & DNC Management Suite', () => {
    it('dispatches outbound proactive notification campaign and manages DNC registry', async () => {
      // 1. Add number to DNC
      const dncRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/campaigns/dnc`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          phoneNumber: '+15554443333',
          reason: 'Customer explicitly requested no automated calls',
        });

      expect(dncRes.status).toBe(201);
      expect(dncRes.body.entry.phoneNumber).toBe('+15554443333');

      // 2. Query DNC list
      const listRes = await request(app)
        .get(`/api/v1/tenants/${tenant1Id}/campaigns/dnc`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.dncRegistry.some((e: any) => e.phoneNumber === '+15554443333')).toBe(true);

      // 3. Dispatch campaign
      const dispatchRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/campaigns/dispatch`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          campaignName: 'Urgent Weather Advisory',
          channel: 'sms',
          messageTemplate: 'Hi {{name}}, freezing temperatures expected tonight. Check your heat pump!',
          bypassCallingHours: true,
          recipients: [
            { recipientPhone: '+15551112222', recipientName: 'Alice' },
            { recipientPhone: '+15554443333', recipientName: 'Bob' }, // On DNC
          ],
        });

      expect(dispatchRes.status).toBe(200);
      expect(dispatchRes.body.totalRecipients).toBe(2);
      expect(dispatchRes.body.dispatchedCount).toBe(1);
      expect(dispatchRes.body.blockedDncCount).toBe(1);

      // 4. Inbound STOP keyword over SMS adds to DNC
      const stopSmsRes = await request(app)
        .post('/api/v1/sms/inbound')
        .type('form')
        .send({
          From: '+15559998888',
          To: '+15559876543',
          Body: 'STOP',
          MessageSid: 'SM_stop_test_001',
        });

      expect(stopSmsRes.status).toBe(200);
      expect(stopSmsRes.text).toContain('unsubscribed and added to our Do Not Call list');

      // Verify that +15559998888 is now on DNC list
      const afterStopList = await request(app)
        .get(`/api/v1/tenants/${tenant1Id}/campaigns/dnc`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(afterStopList.body.dncRegistry.some((e: any) => e.phoneNumber === '+15559998888')).toBe(true);
    });
  });

  describe('Enterprise SSO & SCIM 2.0 Integration Suite', () => {
    it('authenticates enterprise user via SAML assertion and returns session token with mapped role', async () => {
      const mockSaml = `
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
          <saml:Subject>
            <saml:NameID>saml.user@acme-hvac.example.com</saml:NameID>
          </saml:Subject>
          <saml:AttributeStatement>
            <saml:Attribute Name="displayName">
              <saml:AttributeValue>SAML Test Agent</saml:AttributeValue>
            </saml:Attribute>
            <saml:Attribute Name="email">
              <saml:AttributeValue>saml.user@acme-hvac.example.com</saml:AttributeValue>
            </saml:Attribute>
            <saml:Attribute Name="memberOf">
              <saml:AttributeValue>Support-Agents</saml:AttributeValue>
            </saml:Attribute>
          </saml:AttributeStatement>
        </saml:Assertion>
      `;

      const res = await request(app)
        .post(`/api/v1/auth/sso/${tenant1Id}/saml`)
        .send({ xmlAssertion: mockSaml });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('saml.user@acme-hvac.example.com');
      expect(res.body.user.role).toBe('agent');
    });

    it('provisions and queries enterprise user via RFC 7644 SCIM 2.0 API', async () => {
      // 1. Create User via SCIM
      const createRes = await request(app)
        .post(`/api/v1/scim/v2/${tenant1Id}/Users`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'scim.provisioned@acme-hvac.example.com',
          name: {
            givenName: 'Scim',
            familyName: 'User',
            formatted: 'Scim User',
          },
          emails: [{ value: 'scim.provisioned@acme-hvac.example.com', primary: true }],
          active: true,
          roles: [{ value: 'agent' }],
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(createRes.body.userName).toBe('scim.provisioned@acme-hvac.example.com');
      const userId = createRes.body.id;

      // 2. Query SCIM Users List
      const listRes = await request(app)
        .get(`/api/v1/scim/v2/${tenant1Id}/Users`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(listRes.body.Resources.some((u: any) => u.id === userId)).toBe(true);
    });
  });

  describe('Call Flows & Visual IVR Management Suite', () => {
    it('creates a custom call flow and tests step execution', async () => {
      // 1. Create Call Flow
      const createRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/flows`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          name: 'Customer Support Flow',
          startNodeId: 'welcome',
          nodes: [
            {
              id: 'welcome',
              type: 'greeting',
              title: 'Welcome',
              config: { message: 'Thanks for calling Support.' },
              next: 'ai',
            },
            {
              id: 'ai',
              type: 'ai_voice',
              title: 'AI Agent',
              config: { prompt: 'How can I help?' },
            },
          ],
        });

      expect(createRes.status).toBe(201);
      const flowId = createRes.body.flow.id;

      // 2. Test Step Simulation
      const testRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/flows/${flowId}/test`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({});

      expect(testRes.status).toBe(200);
      expect(testRes.body.step.nodeType).toBe('greeting');
      expect(testRes.body.step.promptText).toBe('Thanks for calling Support.');
    });
  });

  describe('Customer 360 & Omnichannel Journey REST Suite', () => {
    it('queries customers and retrieves unified customer 360 journey profile', async () => {
      // 1. List Customers
      const listRes = await request(app)
        .get(`/api/v1/tenants/${tenant1Id}/customers`)
        .set('Authorization', `Bearer ${acmeAdminToken}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.customers)).toBe(true);

      if (listRes.body.customers.length > 0) {
        const testCustId = listRes.body.customers[0].id;
        const journeyRes = await request(app)
          .get(`/api/v1/tenants/${tenant1Id}/customers/${testCustId}/journey`)
          .set('Authorization', `Bearer ${acmeAdminToken}`);

        expect(journeyRes.status).toBe(200);
        expect(journeyRes.body.profile.id).toBe(testCustId);
        expect(Array.isArray(journeyRes.body.profile.journeyEvents)).toBe(true);
      }
    });
  });

  describe('Multi-Carrier Webhooks, Coaching, Orchestration, Biometrics & CRM Sync Suite', () => {
    it('processes Telnyx Call Control v2 and Plivo XML inbound voice webhooks', async () => {
      // 1. Telnyx Call Control v2 Webhook
      const telnyxRes = await request(app)
        .post(`/api/v1/voice/telnyx?tenantId=${tenant1Id}`)
        .send({
          data: {
            event_type: 'call.initiated',
            payload: {
              call_control_id: 'v3:telnyx_cc_001',
              call_leg_id: 'leg_001',
              direction: 'incoming',
              from: '+15552223333',
              to: '+15550199',
            },
          },
        });

      expect(telnyxRes.status).toBe(200);
      expect(telnyxRes.body.provider).toBe('telnyx');
      expect(telnyxRes.body.action).toBe('gather_using_speak');
      expect(telnyxRes.body.command.payload).toContain('Acme Heating');

      // 2. Plivo Inbound XML Webhook
      const plivoRes = await request(app)
        .post(`/api/v1/voice/plivo?tenantId=${tenant1Id}`)
        .send({
          CallUUID: 'plivo_uuid_001',
          From: '+15553334444',
          To: '+15550199',
          Direction: 'inbound',
        });

      expect(plivoRes.status).toBe(200);
      expect(plivoRes.headers['content-type']).toContain('text/xml');
      expect(plivoRes.text).toContain('<GetDigits');
      expect(plivoRes.text).toContain('<Speak');
    });

    it('controls live supervisor coaching modes (silent_monitor, whisper, barge_in)', async () => {
      const whisperRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/calls/call_coach_001/coaching`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({ mode: 'whisper' });

      expect(whisperRes.status).toBe(200);
      expect(whisperRes.body.mode).toBe('whisper');
      expect(whisperRes.body.supervisorAudioRecipients).toEqual(['agent_leg']);

      const bargeRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/calls/call_coach_001/coaching`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({ mode: 'barge_in' });

      expect(bargeRes.status).toBe(200);
      expect(bargeRes.body.mode).toBe('barge_in');
      expect(bargeRes.body.supervisorAudioRecipients).toContain('caller_leg');
      expect(bargeRes.body.supervisorAudioRecipients).toContain('agent_leg');
    });

    it('orchestrates multi-agent department handoff on an active conversation', async () => {
      // Initialize a chat session to get a valid conversationId
      const chatRes = await request(app)
        .post('/api/v1/chat/public/session')
        .send({
          tenantSlug: 'acme-hvac',
          customerName: 'Multi-Agent Tester',
        });
      const convId = chatRes.body.sessionId;

      const orchRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/conversations/${convId}/orchestrate`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          customerMessage: 'I have a question about my invoice charge and payment receipt.',
        });

      expect(orchRes.status).toBe(200);
      expect(orchRes.body.orchestration.activeAgent.id).toBe('billing_agent');
      expect(orchRes.body.orchestration.hasHandedOff).toBe(true);
    });

    it('enrolls and verifies caller voiceprint in PostgreSQL and scores call fraud risk', async () => {
      // 1. Enroll voiceprint
      const enrollRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/security/biometrics/enroll`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          customerId: 'cust_john_doe_001',
          audioSample: 'my_voice_is_my_passport_verify_me_001',
        });

      expect(enrollRes.status).toBe(201);
      expect(enrollRes.body.enrolled).toBe(true);

      // 2. Verify matching voiceprint from PostgreSQL
      const verifyRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/security/biometrics/verify`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          customerId: 'cust_john_doe_001',
          audioSample: 'my_voice_is_my_passport_verify_me_001',
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.verified).toBe(true);
      expect(verifyRes.body.confidenceScore).toBe(1);

      // 3. Evaluate Call Risk Score
      const riskRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/security/risk-score`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          fromNumber: 'Anonymous',
          lineType: 'voip',
          isAnonymous: true,
          recentCallCountLastHour: 12,
        });

      expect(riskRes.status).toBe(200);
      expect(riskRes.body.assessment.riskLevel).toBe('high');
      expect(riskRes.body.assessment.recommendation).toBe('block_review');
    });

    it('synchronizes customer contact and call activity with Salesforce and HubSpot', async () => {
      const sfSyncRes = await request(app)
        .post(`/api/v1/tenants/${tenant1Id}/crm/sync`)
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .send({
          provider: 'salesforce',
          contact: {
            firstName: 'John',
            lastName: 'Doe',
            phone: '+15550101',
            email: 'john.doe@example.com',
          },
          callActivity: {
            externalCallId: 'call_sf_001',
            contactPhone: '+15550101',
            direction: 'inbound',
            durationSeconds: 180,
            status: 'completed',
            summary: 'Annual furnace tune-up scheduled.',
          },
        });

      expect(sfSyncRes.status).toBe(200);
      expect(sfSyncRes.body.contactSync.success).toBe(true);
      expect(sfSyncRes.body.activitySync.success).toBe(true);
    });
  });
});
