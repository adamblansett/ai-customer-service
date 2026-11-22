import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import { StripeBillingService } from '@customer-service/core';
import { createApp } from '../app.js';
import type { Express } from 'express';

describe('SaaS Onboarding, Stripe Webhooks, Connectors, Widget SDK & OTel API Suite', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let app: Express;
  let adminToken: string;
  let tenant1Id: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenant1Id = seed.tenant1Id;
    app = createApp(db);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@acme-hvac.example.com', password: 'DevPassword123!' });
    adminToken = loginRes.body.token;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('provisions a self-serve workspace via POST /api/v1/auth/signup and propagates W3C traceparent headers', async () => {
    const incomingTrace = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const signupRes = await request(app)
      .post('/api/v1/auth/signup')
      .set('traceparent', incomingTrace)
      .send({
        companyName: 'BrightSmile Dental Care',
        ownerName: 'Dr. Hannah Lin',
        ownerEmail: 'hannah@brightsmile.example.com',
        password: 'DentalClinicPassword123!',
        industry: 'dental',
        tier: 'pro',
      });

    expect(signupRes.status).toBe(201);
    expect(signupRes.headers['traceparent']).toMatch(
      /^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[0-9a-f]{16}-01$/
    );
    expect(signupRes.body.token).toBeTruthy();
    expect(signupRes.body.seeded.industry).toBe('dental');
    expect(signupRes.body.seeded.documentsSeeded).toBeGreaterThanOrEqual(1);
  });

  it('serves standalone /api/v1/widget.js bundle and processes signed Stripe webhooks', async () => {
    const sdkRes = await request(app).get(`/api/v1/widget.js?tenantId=${tenant1Id}`);
    expect(sdkRes.status).toBe(200);
    expect(sdkRes.headers['content-type']).toContain('application/javascript');
    expect(sdkRes.text).toContain('__CS_AI_WIDGET_LOADED__');

    // Unsigned Stripe webhook is rejected with 400
    const badWebhook = await request(app)
      .post('/api/v1/stripe/webhook')
      .send({ id: 'evt_bad', type: 'invoice.paid', data: { object: {} } });
    expect(badWebhook.status).toBe(400);

    // Signed Stripe webhook succeeds
    const eventPayload = JSON.stringify({
      id: 'evt_ok_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_acme_01',
          subscription: 'sub_acme_01',
          metadata: { tenantId: tenant1Id, tier: 'enterprise' },
        },
      },
    });
    const sig = StripeBillingService.signWebhookPayload(
      eventPayload,
      'whsec_dev_local_stripe_secret'
    );
    const okWebhook = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sig)
      .send(eventPayload);
    expect(okWebhook.status).toBe(200);
    expect(okWebhook.body.handled).toBe(true);
  });

  it('handles Shopify webhook sync, ServiceNow ticketing, RFC 5545 .ics export, Social DMs, and OTel traces', async () => {
    // Shopify webhook
    const shopifyRes = await request(app)
      .post(`/api/v1/tenants/${tenant1Id}/connectors/webhooks/shopify`)
      .send({
        name: '#5012',
        email: 'buyer@example.com',
        fulfillment_status: 'fulfilled',
        financial_status: 'paid',
        total_price: '149.00',
        fulfillments: [{ tracking_number: '1Z5012TRACK', tracking_url: 'https://ups.example/5012' }],
      });
    expect(shopifyRes.status).toBe(201);
    expect(shopifyRes.body.order.orderNumber).toBe('5012');

    // ServiceNow ticket creation
    const ticketRes = await request(app)
      .post(`/api/v1/tenants/${tenant1Id}/connectors/tickets`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        provider: 'servicenow',
        subject: 'Chiller Loop Pressure Drop',
        description: 'Building B rooftop sensor alert',
        priority: 'urgent',
      });
    expect(ticketRes.status).toBe(201);
    expect(ticketRes.body.ticket.externalKey).toMatch(/^INC00\d+$/);

    // RFC 5545 iCalendar feed
    const icsRes = await request(app)
      .get(`/api/v1/tenants/${tenant1Id}/appointments/ical.ics`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(icsRes.status).toBe(200);
    expect(icsRes.headers['content-type']).toContain('text/calendar');
    expect(icsRes.text).toContain('BEGIN:VCALENDAR');

    // Apple Messages for Business inbound webhook
    const appleRes = await request(app)
      .post(`/api/v1/social/${tenant1Id}/apple_business`)
      .send({
        id: 'msg_apple_1',
        sourceId: 'urn:mbid:AQAAY123',
        body: 'How much is a standard diagnostic visit?',
      });
    expect(appleRes.status).toBe(200);
    expect(appleRes.body.replyText).toContain('$89');

    // OpenTelemetry traces endpoint
    const tracesRes = await request(app)
      .get(`/api/v1/tenants/${tenant1Id}/traces`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(tracesRes.status).toBe(200);
    expect(tracesRes.body.traces.length).toBeGreaterThanOrEqual(1);
  });
});
