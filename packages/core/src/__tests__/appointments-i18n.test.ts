import { describe, it, expect, beforeAll } from 'vitest';
import { getDatabase, seedDatabase, type DatabaseInstance } from '@customer-service/db';
import {
  AppointmentScheduler,
  LanguageRouter,
  KnowledgeRetriever,
  DeterministicSemanticEmbeddingProvider,
  cosineSimilarity,
  ToolRegistry,
  WebhookSignatureVerifier,
  PaymentCollector,
  SurveyEngine,
  AiEvalRunner,
  RealtimeEventBus,
} from '../index.js';

describe('Appointments, Multilingual Auto-Detection & Hybrid Semantic RAG', () => {
  let db: DatabaseInstance;
  let tenant1Id: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seeded = await seedDatabase(db);
    tenant1Id = seeded.tenant1Id;
  });

  it('computes high semantic cosine similarity for HVAC synonyms via DeterministicSemanticEmbeddingProvider', async () => {
    const embedder = new DeterministicSemanticEmbeddingProvider();
    const vHeater = await embedder.embedText('My heater is blowing freezing cold air in winter');
    const vFurnace = await embedder.embedText('Emergency furnace heating failure and boiler ignition');
    const vBilling = await embedder.embedText('Monthly credit card invoice payment and subscription');

    const simHeating = cosineSimilarity(vHeater, vFurnace);
    const simUnrelated = cosineSimilarity(vHeater, vBilling);

    expect(simHeating).toBeGreaterThan(0.6);
    expect(simHeating).toBeGreaterThan(simUnrelated);
  });

  it('retrieves knowledge chunks using Hybrid Semantic + Keyword RAG when caller uses synonyms', async () => {
    const retriever = new KnowledgeRetriever(db);
    // "heater blowing freezing air" shares semantic cluster with "emergency heating failure"
    const hits = await retriever.search(tenant1Id, 'My heater is blowing freezing air tonight');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content.toLowerCase()).toContain('heating');
  });

  it('checks conflict-free technician slots, books, reschedules, and cancels appointments', async () => {
    const scheduler = new AppointmentScheduler(db);

    // 1. Check slots on 2026-11-20 (seed has Marcus Vance booked 08:00-10:00)
    const slots = await scheduler.checkAvailableSlots(tenant1Id, '2026-11-20');
    expect(slots).toHaveLength(4);
    const morningSlot = slots.find((s) => s.startIso.includes('T08:00:00'));
    expect(morningSlot).toBeDefined();
    expect(morningSlot!.availableTechnicians).not.toContain('Marcus Vance');
    expect(morningSlot!.availableTechnicians).toContain('Elena Rostova');

    // 2. Book appointment in 10:00-12:00 window
    const booked = await scheduler.bookAppointment({
      tenantId: tenant1Id,
      customerName: 'Alice Rivera',
      customerPhone: '+15550999',
      serviceType: 'ac_tuneup',
      scheduledStart: '2026-11-20T10:00:00.000Z',
      scheduledEnd: '2026-11-20T12:00:00.000Z',
      notes: 'Annual AC inspection',
    });
    expect(booked.id).toMatch(/^appt_/);
    expect(booked.status).toBe('confirmed');
    expect(booked.technicianName).toBe('Marcus Vance');

    // 3. Attempting to double-book Marcus Vance in the exact same window throws conflict
    await expect(
      scheduler.bookAppointment({
        tenantId: tenant1Id,
        customerName: 'Bob Conflict',
        customerPhone: '+15550888',
        serviceType: 'furnace_repair',
        scheduledStart: '2026-11-20T10:00:00.000Z',
        scheduledEnd: '2026-11-20T12:00:00.000Z',
        technicianName: 'Marcus Vance',
      })
    ).rejects.toThrow(/already booked/);

    // 4. Reschedule appointment
    const rescheduled = await scheduler.rescheduleAppointment(
      tenant1Id,
      booked.id,
      '2026-11-21T13:00:00.000Z',
      '2026-11-21T15:00:00.000Z'
    );
    expect(rescheduled.status).toBe('rescheduled');

    // 5. Cancel appointment
    const cancelled = await scheduler.cancelAppointment(
      tenant1Id,
      booked.id,
      'Customer resolved issue'
    );
    expect(cancelled.status).toBe('cancelled');
  });

  it('auto-detects Spanish, French, German, and Mandarin and expands cross-lingual RAG queries', async () => {
    const router = new LanguageRouter();
    const retriever = new KnowledgeRetriever(db);

    const esProfile = router.detectAndRoute(
      'Hola, necesito ayuda urgente con mi calefacción, ¿cuánto cuesta el diagnóstico?',
      { businessName: 'Acme Heating' }
    );
    expect(esProfile.locale).toBe('es-US');
    expect(esProfile.twimlVoice).toBe('Polly.Lupe');
    expect(esProfile.kokoroVoice).toBe('ef_dora');
    expect(esProfile.augmentedRagQuery).toContain('pricing diagnostic fee');

    // Verify cross-lingual RAG retrieves English pricing & heating chunks for a Spanish query!
    const ragHits = await retriever.search(tenant1Id, esProfile.augmentedRagQuery);
    expect(ragHits.length).toBeGreaterThan(0);

    const frProfile = router.detectAndRoute('Bonjour, j’ai besoin d’un rendez-vous pour mon chauffage.');
    expect(frProfile.locale).toBe('fr-FR');
    expect(frProfile.twimlVoice).toBe('Polly.Lea');

    const zhProfile = router.detectAndRoute('你好，请问暖气维修多少钱？');
    expect(zhProfile.locale).toBe('zh-CN');
    expect(zhProfile.twimlVoice).toBe('Polly.Zhiyu');
  });

  it('executes check_available_slots and book_appointment tools via ToolRegistry and verifies carrier webhook signatures', async () => {
    const registry = new ToolRegistry(db);
    const tools = registry.getPermittedToolDefinitions();
    expect(tools.some((t) => t.name === 'book_appointment')).toBe(true);

    const slotExec = await registry.executeTool(
      'check_available_slots',
      { date: '2026-11-28' },
      { tenantId: tenant1Id, conversationId: 'conv_test_001' }
    );
    expect(slotExec.success).toBe(true);
    expect(slotExec.data.slots).toHaveLength(4);

    const bookExec = await registry.executeTool(
      'book_appointment',
      {
        customerName: 'Diana Prince',
        customerPhone: '+15550444',
        serviceType: 'ac_tuneup',
        scheduledStart: '2026-11-28T08:00:00.000Z',
        scheduledEnd: '2026-11-28T10:00:00.000Z',
      },
      { tenantId: tenant1Id, conversationId: 'conv_test_001' }
    );
    expect(bookExec.success).toBe(true);
    expect(bookExec.data.appointment.status).toBe('confirmed');

    // Verify Twilio, Plivo, and WhatsApp HMAC signatures
    const url = 'https://api.acme-hvac.example.com/api/v1/voice/inbound';
    const params = { CallSid: 'CA12345', From: '+15550101', To: '+18005550199' };
    const sig = WebhookSignatureVerifier.computeTwilioSignature('secret_token', url, params);
    expect(WebhookSignatureVerifier.verifyTwilioSignature('secret_token', url, params, sig)).toBe(true);
    expect(WebhookSignatureVerifier.verifyTwilioSignature('secret_token', url, params, 'forged_sig')).toBe(false);

    const waSig = WebhookSignatureVerifier.computeWhatsAppSignature('meta_secret', '{"entry":[]}');
    expect(WebhookSignatureVerifier.verifyWhatsAppSignature('meta_secret', '{"entry":[]}', waSig)).toBe(true);
  });

  it('collects PCI-DSS payments (link + masked DTMF), dispatches CSAT surveys with low-score alerts, and runs Golden AI Eval Suite', async () => {
    const collector = new PaymentCollector(db);
    const linkPay = await collector.createPaymentLink({
      tenantId: tenant1Id,
      customerPhone: '+15550101',
      description: 'Standard HVAC Diagnostic Fee',
      amountCents: 8900,
    });
    expect(linkPay.checkoutUrl).toContain('/checkout/pay_');
    expect(linkPay.status).toBe('pending');

    const dtmfPay = await collector.processDtmfMaskedPayment({
      tenantId: tenant1Id,
      customerPhone: '+15550101',
      description: 'Emergency Dispatch Deposit',
      amountCents: 14900,
      dtmfCardDigits: '4111111111114242',
    });
    expect(dtmfPay.maskedCardLast4).toBe('****-****-****-4242');
    expect(dtmfPay.status).toBe('paid');

    const surveyEngine = new SurveyEngine(db);
    const { survey } = await surveyEngine.dispatchSurvey({
      tenantId: tenant1Id,
      customerPhone: '+15550101',
      channel: 'sms',
    });
    const lowScoreRes = await surveyEngine.recordSurveyResponse({
      tenantId: tenant1Id,
      surveyId: survey.id,
      score: 1,
      feedbackText: 'Technician arrived late',
    });
    expect(lowScoreRes.supervisorAlerted).toBe(true);
    expect(lowScoreRes.survey.status).toBe('escalated_low_score');

    const evalRunner = new AiEvalRunner(db);
    const evalReport = await evalRunner.runEvaluationSuite(tenant1Id);
    expect(evalReport.overallScorePercent).toBe(100);
    expect(evalReport.passedCount).toBe(6);

    const published = RealtimeEventBus.publish(tenant1Id, 'call.started', { callSid: 'CA_SSE_1' });
    expect(RealtimeEventBus.getRecentEvents(tenant1Id)[0].id).toBe(published.id);
  });
});
