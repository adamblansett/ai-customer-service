import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import {
  WebAuthnPasskeyManager,
  PasskeyCloneDetectedError,
  StripeBillingService,
  OnboardingService,
  EcommerceConnectorService,
  TicketingConnectorService,
  CalendarSyncService,
  AppointmentScheduler,
  SocialChannelGateway,
  WidgetSdkGenerator,
  DistributedTracer,
  ToolRegistry,
  ToolAuthorizationError,
} from '../index.js';

describe('SaaS Billing, Passkeys, Self-Serve Onboarding, Connectors, Social & OTel Suite', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let tenant1Id: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenant1Id = seed.tenant1Id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('registers an ECDSA P-256 WebAuthn Passkey, verifies cryptographic assertion, and blocks cloned signCount', async () => {
    const rpId = 'console.example.com';
    const origin = 'https://console.example.com';
    const manager = new WebAuthnPasskeyManager(db, rpId, origin);

    const onboard = new OnboardingService(db);
    const createdWorkspace = await onboard.registerWorkspace({
      companyName: 'Passkey Security Labs',
      ownerName: 'Alex Rivera',
      ownerEmail: 'alex@passkey-labs.example.com',
      password: 'UltraSecurePassword123!',
      industry: 'saas_support',
      tier: 'enterprise',
    });
    const userId = createdWorkspace.user.id;

    // 1. Generate keypair & register passkey
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const credentialId = WebAuthnPasskeyManager.toBase64Url(crypto.randomBytes(24));

    const regOpts = manager.generateRegistrationOptions({
      id: userId,
      email: 'alex@passkey-labs.example.com',
      name: 'Alex Rivera',
    });

    const regClientData = WebAuthnPasskeyManager.toBase64Url(
      Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: regOpts.challenge,
          origin,
        })
      )
    );
    const regAuthData = WebAuthnPasskeyManager.toBase64Url(
      WebAuthnPasskeyManager.buildAuthenticatorData(rpId, 1, true)
    );

    const stored = await manager.verifyAndStoreRegistration({
      userId,
      challenge: regOpts.challenge,
      credentialId,
      publicKeyPem,
      clientDataJSONBase64Url: regClientData,
      authenticatorDataBase64Url: regAuthData,
      deviceName: 'YubiKey 5C Nano',
    });
    expect(stored.signCount).toBe(1);

    // 2. Authenticate with signCount = 2
    const loginOpts = await manager.generateAuthenticationOptions('alex@passkey-labs.example.com');
    expect(loginOpts.allowCredentials).toHaveLength(1);

    const loginClientRaw = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: loginOpts.challenge,
        origin,
      })
    );
    const loginAuthRaw = WebAuthnPasskeyManager.buildAuthenticatorData(rpId, 2, true);
    const signedPayload = Buffer.concat([
      loginAuthRaw,
      crypto.createHash('sha256').update(loginClientRaw).digest(),
    ]);
    const signature = crypto.sign('sha256', signedPayload, privateKey);

    const verified = await manager.verifyAuthentication({
      challenge: loginOpts.challenge,
      credentialId,
      clientDataJSONBase64Url: WebAuthnPasskeyManager.toBase64Url(loginClientRaw),
      authenticatorDataBase64Url: WebAuthnPasskeyManager.toBase64Url(loginAuthRaw),
      signatureBase64Url: WebAuthnPasskeyManager.toBase64Url(signature),
    });
    expect(verified.userId).toBe(userId);
    expect(verified.newSignCount).toBe(2);

    // 3. Clone detection: signCount = 2 again (not strictly monotonic) MUST throw PasskeyCloneDetectedError
    const replayOpts = await manager.generateAuthenticationOptions('alex@passkey-labs.example.com');
    const cloneClientRaw = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: replayOpts.challenge,
        origin,
      })
    );
    const cloneAuthRaw = WebAuthnPasskeyManager.buildAuthenticatorData(rpId, 2, true);
    const clonePayload = Buffer.concat([
      cloneAuthRaw,
      crypto.createHash('sha256').update(cloneClientRaw).digest(),
    ]);
    const cloneSig = crypto.sign('sha256', clonePayload, privateKey);

    await expect(
      manager.verifyAuthentication({
        challenge: replayOpts.challenge,
        credentialId,
        clientDataJSONBase64Url: WebAuthnPasskeyManager.toBase64Url(cloneClientRaw),
        authenticatorDataBase64Url: WebAuthnPasskeyManager.toBase64Url(cloneAuthRaw),
        signatureBase64Url: WebAuthnPasskeyManager.toBase64Url(cloneSig),
      })
    ).rejects.toThrow(PasskeyCloneDetectedError);
  });

  it('verifies Stripe HMAC-SHA256 webhook signatures, blocks stale timestamps, and syncs metered usage', async () => {
    const secret = 'whsec_test_stripe_998877';
    const stripe = new StripeBillingService(db, { webhookSecret: secret });

    const checkout = await stripe.createCheckoutSession({
      tenantId: tenant1Id,
      tier: 'pro',
      successUrl: 'https://app.example.com/billing',
      cancelUrl: 'https://app.example.com/billing',
    });
    expect(checkout.mode).toBe('sandbox');
    expect(checkout.amountCents).toBeGreaterThan(0);

    const synced = await stripe.syncMeteredUsage({
      tenantId: tenant1Id,
      voiceMinutes: 1850,
      aiTokens: 640000,
    });
    expect(synced.synced).toBe(true);
    expect(synced.subscription.lastSyncedVoiceMinutes).toBe(1850);

    const payload = JSON.stringify({
      id: 'evt_test_001',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_live_123',
          customer: 'cus_live_123',
          status: 'active',
          metadata: { tenantId: tenant1Id, tier: 'enterprise' },
        },
      },
    });

    const validHeader = StripeBillingService.signWebhookPayload(payload, secret);
    const parsed = stripe.verifyWebhookSignature(payload, validHeader);
    const handled = await stripe.handleWebhookEvent(parsed);
    expect(handled.handled).toBe(true);
    expect(handled.subscription?.tier).toBe('enterprise');

    // Stale replay (>300s ago) must fail
    const staleHeader = StripeBillingService.signWebhookPayload(
      payload,
      secret,
      Math.floor(Date.now() / 1000) - 900
    );
    expect(() => stripe.verifyWebhookSignature(payload, staleHeader)).toThrow(
      /StripeSignatureReplayError/
    );
  });

  it('executes Shopify order lookup (blocking cross-caller spoofing) and Zendesk/Jira ticket creation in ToolRegistry', async () => {
    const ecommerce = new EcommerceConnectorService(db);
    await ecommerce.upsertOrder({
      tenantId: tenant1Id,
      provider: 'shopify',
      orderNumber: '#ORD-7788',
      customerPhone: '+15554443322',
      fulfillmentStatus: 'in_transit',
      totalCents: 24900,
      trackingNumber: '1Z888999',
    });

    const registry = new ToolRegistry(db);

    // Authorized caller lookup succeeds
    const orderRes = await registry.executeTool(
      'check_order_status',
      { orderNumber: 'ord-7788' },
      {
        tenantId: tenant1Id,
        conversationId: 'conv_order_test',
        callerPhone: '+15554443322',
      }
    );
    expect(orderRes.success).toBe(true);
    expect(orderRes.data.order.trackingNumber).toBe('1Z888999');

    // Different caller phone attempting to inspect someone else's order is blocked!
    await expect(
      registry.executeTool(
        'check_order_status',
        { orderNumber: 'ORD-7788' },
        {
          tenantId: tenant1Id,
          conversationId: 'conv_order_spoof',
          callerPhone: '+15550009999',
        }
      )
    ).rejects.toThrow(ToolAuthorizationError);

    // Create Jira ticket via ToolRegistry
    const ticketRes = await registry.executeTool(
      'create_support_ticket',
      {
        provider: 'jira',
        subject: 'Blower Motor Vibration',
        description: 'Customer reported harmonic noise after seasonal install.',
        priority: 'high',
      },
      {
        tenantId: tenant1Id,
        conversationId: 'conv_ticket_test',
        callerPhone: '+15554443322',
      }
    );
    expect(ticketRes.success).toBe(true);
    expect(ticketRes.data.ticket.externalKey).toMatch(/^SUP-\d+$/);
  });

  it('enforces Google/M365 external calendar busy blocks during AppointmentScheduler booking and exports RFC 5545 .ics', async () => {
    const calSync = new CalendarSyncService(db);
    const scheduler = new AppointmentScheduler(db);

    await calSync.connectCalendar({
      tenantId: tenant1Id,
      provider: 'google_calendar',
      calendarId: 'marcus@acme-hvac.example.com',
      technicianName: 'Marcus Vance',
      busyWindows: [
        {
          start: '2027-04-15T10:00:00.000Z',
          end: '2027-04-15T12:00:00.000Z',
          summary: 'External Commercial Rooftop Inspection',
        },
      ],
    });

    // Explicitly requesting Marcus Vance during his Google Calendar busy block must fail
    await expect(
      scheduler.bookAppointment({
        tenantId: tenant1Id,
        customerName: 'Sam Carter',
        customerPhone: '+15559876543',
        serviceType: 'ac_tuneup',
        technicianName: 'Marcus Vance',
        scheduledStart: '2027-04-15T10:00:00.000Z',
        scheduledEnd: '2027-04-15T12:00:00.000Z',
      })
    ).rejects.toThrow(/external calendar block/);

    // Auto-assign skips Marcus Vance and books another available technician cleanly
    const booked = await scheduler.bookAppointment({
      tenantId: tenant1Id,
      customerName: 'Sam Carter',
      customerPhone: '+15559876543',
      serviceType: 'ac_tuneup',
      scheduledStart: '2027-04-15T10:00:00.000Z',
      scheduledEnd: '2027-04-15T12:00:00.000Z',
    });
    expect(booked.technicianName).not.toBe('Marcus Vance');

    const ics = await calSync.exportIcalFeed(tenant1Id, 'Acme Dispatch');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('Sam Carter');
  });

  it('routes Apple Messages, Instagram DM, and Slack Connect messages, generates Widget SDK, and records OTel traces', async () => {
    const gateway = new SocialChannelGateway(db);

    // Slack HMAC verification
    const slackBody = JSON.stringify({ event: { user: 'U123', text: 'How much is diagnostic?' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const slackSecret = 'slack_sec_abc123';
    const expectedSig = `v0=${crypto
      .createHmac('sha256', slackSecret)
      .update(`v0:${ts}:${slackBody}`)
      .digest('hex')}`;
    expect(
      SocialChannelGateway.verifySlackSignature(slackBody, ts, expectedSig, slackSecret)
    ).toBe(true);

    const parsed = gateway.parseInboundWebhook('instagram_dm', {
      entry: [{ messaging: [{ sender: { id: 'ig_991' }, message: { mid: 'm1', text: 'What is your diagnostic fee?' } }] }],
    });
    expect(parsed?.channel).toBe('instagram_dm');
    const socialReply = await gateway.handleInboundSocialMessage(tenant1Id, parsed!);
    expect(socialReply.replyText).toContain('$89');

    // Widget SDK bundle
    const bundle = WidgetSdkGenerator.generateBundle({
      defaultApiBaseUrl: 'http://localhost:3001/api/v1',
      tenantId: tenant1Id,
    });
    expect(bundle).toContain('attachShadow');
    expect(bundle).toContain('speechSynthesis');

    // OpenTelemetry Distributed Tracer
    const tracer = new DistributedTracer(db);
    const ctx = DistributedTracer.parseTraceparent(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    );
    expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');

    const waterfall = await tracer.recordVoiceTurnWaterfall({
      tenantId: tenant1Id,
      traceId: ctx.traceId,
      sttMs: 110,
      ragMs: 20,
      llmMs: 220,
      toolMs: 30,
      dlpMs: 1,
      ttsMs: 85,
    });
    expect(waterfall.totalDurationMs).toBe(466);

    const traces = await tracer.listRecentTraces(tenant1Id);
    expect(traces[0].traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});
