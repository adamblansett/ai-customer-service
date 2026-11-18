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
  VisualDiagnosticsEngine,
  WorkforceManager,
  AmdDetector,
  TenantWebhookRegistry,
  generateOpenApiSpec,
  IncidentDispatcher,
  DatasetExporter,
  KnowledgeGovernance,
  FollowUpComposer,
  ExperimentEngine,
  AudioRedactor,
  AgentScorecardService,
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

    // 7. Visual Diagnostics, Erlang-C WFM, AMD Voicemail Drop, and Outbound Webhooks
    const vision = new VisualDiagnosticsEngine(db);
    const diag = await vision.analyzeEquipmentImage({
      tenantId: tenant1Id,
      imageUrlOrBase64: 'upload://furnace_e1.jpg',
      customerNotes: 'Thermostat blinking E1 ignition lockout in freezing weather',
    });
    expect(diag.detectedFaultCode).toBe('ERR_E1_IGNITION_LOCKOUT');
    expect(diag.urgency).toBe('emergency');
    expect(diag.knowledgeRecommendations.length).toBeGreaterThan(0);

    const wfm = new WorkforceManager(db);
    const forecast = wfm.calculateErlangCStaffing({
      callsPerHour: 120,
      averageHandleTimeSeconds: 180,
      targetAnswerSeconds: 20,
      targetSlaPercent: 80,
    });
    expect(forecast.trafficErlangs).toBe(6);
    expect(forecast.recommendedAgents).toBeGreaterThan(6);
    expect(forecast.expectedSlaPercent).toBeGreaterThanOrEqual(80);

    const amd = new AmdDetector();
    const vmDecision = amd.classifyCallAnswer({
      greetingDurationMs: 3800,
      beepDetected: true,
      transcript: 'Please leave a message after the beep',
      customerName: 'John Doe',
    });
    expect(vmDecision.classification).toBe('machine_detected_beep');
    expect(vmDecision.action).toBe('drop_voicemail_and_sms');
    expect(vmDecision.triggerSmsFollowUp).toBe(true);

    const whRegistry = new TenantWebhookRegistry(db);
    await whRegistry.createSubscription({
      tenantId: tenant1Id,
      targetUrl: 'https://hooks.zapier.example.com/acme',
      events: ['appointment.booked'],
    });
    const receipts = await whRegistry.dispatchEvent(tenant1Id, 'appointment.booked', {
      appointmentId: 'appt_123',
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].delivered).toBe(true);
    expect(receipts[0].signatureHeader).toMatch(/^sha256=/);

    // 8. OpenAPI 3.1 Spec, Incident Dispatcher, LoRA Dataset Exporter & Knowledge Governance Rollback
    const spec = generateOpenApiSpec();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/api/v1/tenants/{tenantId}/ai/builtin']).toBeDefined();

    const incidentDispatcher = new IncidentDispatcher();
    const incRes = await incidentDispatcher.dispatchIncident({
      tenantId: tenant1Id,
      title: 'Emergency Queue Breach',
      severity: 'critical',
      source: 'sla_queue_breach',
      summary: 'Caller waiting > 60s',
    });
    expect(incRes.dispatched).toBe(true);
    expect(incRes.slackPayload.blocks).toHaveLength(3);
    expect(incRes.pagerDutyPayload.event_action).toBe('trigger');

    const exporter = new DatasetExporter(db);
    const ds = await exporter.exportFineTuningDataset(tenant1Id, 'sharegpt');
    expect(ds.piiRedacted).toBe(true);
    expect(ds.exampleCount).toBeGreaterThan(0);

    const governance = new KnowledgeGovernance(db);
    const v1 = await governance.createVersionSnapshot({
      tenantId: tenant1Id,
      documentId: 'doc_acme_hours_001',
      title: 'Business Hours and Emergency Service Policy',
      rawContent: 'Original Hours: Monday through Friday 8 AM to 6 PM.',
      changeNote: 'v1 baseline',
    });
    await governance.createVersionSnapshot({
      tenantId: tenant1Id,
      documentId: 'doc_acme_hours_001',
      title: 'Business Hours Updated',
      rawContent: 'Temporary holiday hours.',
      changeNote: 'v2 holiday update',
    });
    const rolledBack = await governance.rollbackToVersion(
      tenant1Id,
      'doc_acme_hours_001',
      v1.versionNumber
    );
    expect(rolledBack.restoredVersion).toBe(v1.versionNumber);
    expect(rolledBack.document.rawContent).toContain('Original Hours');

    // 9. Post-Call Follow-Up Composer, A/B Experiment Engine, Audio Redactor & Agent Scorecards
    const followUp = new FollowUpComposer(db);
    const recap = await followUp.composeFollowUp({
      tenantId: tenant1Id,
      callSid: 'CA9876543210',
      callerPhone: '+15550101',
    });
    expect(recap.referenceNumber).toBe('REF-543210');
    expect(recap.smsBody).toContain('Acme Heating & Cooling');

    const expEngine = new ExperimentEngine(db);
    const exp = await expEngine.createExperiment({
      tenantId: tenant1Id,
      name: 'Qwen 7B vs Llama 8B Greeting Test',
      variantAPrompt: 'Concise greeting',
      variantBPrompt: 'Empathetic greeting',
    });
    await expEngine.recordOutcome(tenant1Id, exp.id, 'A', { csatScore: 5, resolved: true });
    const updatedExp = await expEngine.recordOutcome(tenant1Id, exp.id, 'B', {
      csatScore: 4,
      resolved: true,
    });
    expect(updatedExp.metrics.winningVariant).toBe('A');

    const redactor = new AudioRedactor();
    const rawBuf = Buffer.alloc(800, 0x11).toString('base64'); // 100ms at 8kHz
    const scrubbed = redactor.scrubAudioWithWordTimestamps({
      audioBase64: rawBuf,
      sampleRateHz: 8000,
      words: [
        { word: 'card', startMs: 0, endMs: 20 },
        { word: '4242', startMs: 20, endMs: 80 },
      ],
    });
    expect(scrubbed.piiWordsRedactedCount).toBe(1);
    expect(scrubbed.pciCompliant).toBe(true);

    const scorecards = new AgentScorecardService().getTenantLeaderboard(tenant1Id);
    expect(scorecards[0].rank).toBe(1);
  });
});
