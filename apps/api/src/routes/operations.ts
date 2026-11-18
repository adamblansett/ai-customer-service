import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import {
  CallQueueManager,
  ConversationAnalyzer,
  UsageMeter,
  SUBSCRIPTION_PLANS,
  type SubscriptionTier,
  AppointmentScheduler,
  APPOINTMENT_AI_TOOLS,
  LanguageRouter,
  KnowledgeRetriever,
  PaymentCollector,
  SurveyEngine,
  AiEvalRunner,
  RealtimeEventBus,
  VisualDiagnosticsEngine,
  WorkforceManager,
  AmdDetector,
  TenantWebhookRegistry,
  IncidentDispatcher,
  DatasetExporter,
  KnowledgeGovernance,
  type FineTuningFormat,
  FollowUpComposer,
  ExperimentEngine,
  AudioRedactor,
  AgentScorecardService,
} from '@customer-service/core';

const globalQueueManager = new CallQueueManager();
const initializedQueueTenants = new Set<string>();
const globalUsageMeter = new UsageMeter();
const initializedBillingTenants = new Set<string>();

function ensureTenantQueueInitialized(tenantId: string) {
  if (initializedQueueTenants.has(tenantId)) return;
  initializedQueueTenants.add(tenantId);

  globalQueueManager.registerAgent({
    agentId: 'ag-1',
    tenantId,
    name: 'Sarah Agent',
    status: 'idle',
    skills: ['emergency', 'hvac-tech', 'billing', 'general-inquiry'],
  });
  globalQueueManager.registerAgent({
    agentId: 'ag-2',
    tenantId,
    name: 'Marcus Vance',
    status: 'busy',
    skills: ['hvac-tech', 'commercial'],
    activeCallSid: 'CA_LIVE_88210',
  });
  globalQueueManager.registerAgent({
    agentId: 'ag-3',
    tenantId,
    name: 'Elena Rostova',
    status: 'idle',
    skills: ['billing', 'spanish', 'general-inquiry'],
  });
  globalQueueManager.registerAgent({
    agentId: 'ag-4',
    tenantId,
    name: 'David Chen',
    status: 'offline',
    skills: ['commercial', 'hvac-tech'],
  });

  globalQueueManager.enqueueCall({
    tenantId,
    callSid: 'CA_LIVE_49201',
    callerPhone: '+1 (555) 349-2041',
    priority: 10,
    requiredSkills: ['emergency', 'hvac-tech'],
  });
  globalQueueManager.enqueueCall({
    tenantId,
    callSid: 'CA_LIVE_58194',
    callerPhone: '+1 (555) 892-1140',
    priority: 5,
    requiredSkills: ['billing'],
  });
}

export function createOperationsRouter(db: DatabaseInstance): Router {
  const router = Router();
  const analyzer = new ConversationAnalyzer();
  const scheduler = new AppointmentScheduler(db);
  const languageRouter = new LanguageRouter();
  const retriever = new KnowledgeRetriever(db);
  const paymentCollector = new PaymentCollector(db);
  const surveyEngine = new SurveyEngine(db);
  const evalRunner = new AiEvalRunner(db);
  const visualDiagnostics = new VisualDiagnosticsEngine(db);
  const workforceManager = new WorkforceManager(db);
  const amdDetector = new AmdDetector();
  const webhookRegistry = new TenantWebhookRegistry(db);
  const incidentDispatcher = new IncidentDispatcher();
  const datasetExporter = new DatasetExporter(db);
  const knowledgeGovernance = new KnowledgeGovernance(db);
  const followUpComposer = new FollowUpComposer(db);
  const experimentEngine = new ExperimentEngine(db);
  const audioRedactor = new AudioRedactor();
  const scorecardService = new AgentScorecardService();

  // ============================================================================
  // 1. Contact Center Queues & ACD Wallboard Endpoints
  // ============================================================================
  router.get(
    '/:tenantId/queues',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      ensureTenantQueueInitialized(tenantId);

      const stats = globalQueueManager.getQueueStats(tenantId);
      const rawQueue = ((globalQueueManager as any).queues.get(tenantId) || []) as any[];
      const rawAgents = Array.from(((globalQueueManager as any).agents as Map<string, any>).values()).filter(
        (a) => a.tenantId === tenantId
      );

      const queue = rawQueue.map((item) => ({
        id: item.queueId,
        callSid: item.callSid,
        phoneNumber: item.callerPhone,
        priority: item.priority >= 10 ? 'urgent' : item.priority >= 5 ? 'high' : 'normal',
        requiredSkills: item.requiredSkills || [],
        enqueuedAt: 'Just now',
        waitSeconds: Math.max(
          15,
          Math.floor((Date.now() - new Date(item.enqueuedAt).getTime()) / 1000) || item.estimatedWaitSeconds
        ),
      }));

      const agents = rawAgents.map((ag) => ({
        id: ag.agentId,
        name: ag.name,
        status: ag.status === 'idle' ? 'available' : ag.status === 'busy' ? 'on_call' : 'away',
        skills: ag.skills,
        callsHandled: ag.agentId === 'ag-2' ? 19 : ag.agentId === 'ag-1' ? 14 : 11,
        idleMinutes: ag.status === 'idle' ? 6 : 0,
      }));

      res.json({ stats, queue, agents });
    }
  );

  router.post(
    '/:tenantId/queues/enqueue',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      ensureTenantQueueInitialized(tenantId);

      const { callSid, callerPhone, priority = 'normal', requiredSkills = [] } = req.body;
      const numericPriority = priority === 'urgent' ? 10 : priority === 'high' ? 5 : 1;

      const queued = globalQueueManager.enqueueCall({
        tenantId,
        callSid: callSid || `CA_${Date.now()}`,
        callerPhone: callerPhone || '+1 (555) 019-9900',
        priority: numericPriority,
        requiredSkills,
      });

      res.status(201).json({
        queuedCall: queued,
        stats: globalQueueManager.getQueueStats(tenantId),
      });
    }
  );

  router.post(
    '/:tenantId/queues/assign',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      ensureTenantQueueInitialized(tenantId);

      const { strategy = 'longest-idle' } = req.body;
      const assignment = globalQueueManager.tryAssignNextCall(tenantId, strategy);

      res.json({
        assigned: Boolean(assignment),
        assignment,
        stats: globalQueueManager.getQueueStats(tenantId),
      });
    }
  );

  router.post(
    '/:tenantId/queues/agents/:agentId/status',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, agentId } = req.params;
      ensureTenantQueueInitialized(tenantId);

      const { status } = req.body; // 'available' | 'on_call' | 'away' | 'idle' | 'busy' | 'offline'
      const mapped =
        status === 'available' || status === 'idle'
          ? 'idle'
          : status === 'on_call' || status === 'busy'
          ? 'busy'
          : 'offline';

      globalQueueManager.setAgentStatus(agentId, mapped);
      res.json({
        success: true,
        agentId,
        status: mapped,
        stats: globalQueueManager.getQueueStats(tenantId),
      });
    }
  );

  // ============================================================================
  // 2. Post-Call Analytics & CSAT Endpoints
  // ============================================================================
  router.get(
    '/:tenantId/analytics',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;

      const convs = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.tenantId, tenantId));

      const insights: any[] = [];

      for (const conv of convs.slice(0, 15)) {
        const msgs = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, conv.id));

        const report = await analyzer.analyze({
          ...(conv as any),
          messages: msgs as any,
        });

        insights.push({
          id: conv.id,
          phoneNumber: (conv.metadata as any)?.from || '+1 (555) 349-2041',
          durationSeconds: 145,
          sentiment: report.sentiment,
          csat: report.csatEstimate,
          resolved: report.resolutionStatus === 'resolved',
          compliancePassed:
            report.compliance.aiDisclosed && report.compliance.prohibitedActionsAvoided,
          topics: report.keyTopics,
          summary: report.summary,
          timestamp: new Date(conv.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        });
      }

      if (insights.length === 0) {
        insights.push(
          {
            id: 'an-seed-1',
            phoneNumber: '+1 (555) 349-2041',
            durationSeconds: 168,
            sentiment: 'positive',
            csat: 5,
            resolved: true,
            compliancePassed: true,
            topics: ['furnace_repair', 'emergency', 'scheduling'],
            summary:
              'Customer called with emergency heating loss in freezing temperatures. Assistant verified 24/7 dispatch protocol and confirmed technician slot.',
            timestamp: '15 mins ago',
          },
          {
            id: 'an-seed-2',
            phoneNumber: '+1 (555) 892-1140',
            durationSeconds: 215,
            sentiment: 'neutral',
            csat: 4,
            resolved: true,
            compliancePassed: true,
            topics: ['pricing', 'hours'],
            summary:
              'Caller asked about standard $89 diagnostic fee and Saturday operating hours. Grounded response delivered with source attribution.',
            timestamp: '42 mins ago',
          }
        );
      }

      const avgCsat =
        Math.round(
          (insights.reduce((acc, item) => acc + item.csat, 0) / insights.length) * 10
        ) / 10;
      const resolutionRate = Math.round(
        (insights.filter((i) => i.resolved).length / insights.length) * 100
      );
      const complianceRate = Math.round(
        (insights.filter((i) => i.compliancePassed).length / insights.length) * 100
      );

      res.json({
        summary: {
          averageCsat: avgCsat,
          resolutionRatePercent: resolutionRate,
          compliancePassPercent: complianceRate,
          totalAnalyzed: insights.length,
        },
        insights,
      });
    }
  );

  // ============================================================================
  // 3. Subscription & Usage Metering Endpoints
  // ============================================================================
  router.get(
    '/:tenantId/billing',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;

      if (!initializedBillingTenants.has(tenantId)) {
        initializedBillingTenants.add(tenantId);
        globalUsageMeter.setTenantPlan(tenantId, 'pro', 4);
        globalUsageMeter.recordVoiceSeconds(tenantId, 1420 * 60);
        globalUsageMeter.recordAiTokens(tenantId, 320000, 162000);
      }

      const summary = globalUsageMeter.getUsageSummary(tenantId);
      const invoice = globalUsageMeter.calculateMonthlyInvoice(tenantId);

      res.json({
        summary,
        invoice,
        plans: SUBSCRIPTION_PLANS,
      });
    }
  );

  router.post(
    '/:tenantId/billing/tier',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const { tier } = req.body as { tier?: SubscriptionTier };

      if (!tier || !SUBSCRIPTION_PLANS[tier]) {
        res.status(400).json({ error: "Invalid tier. Must be 'starter', 'pro', or 'enterprise'." });
        return;
      }

      const existing = globalUsageMeter.getUsageSummary(tenantId);
      globalUsageMeter.setTenantPlan(tenantId, tier, existing.activeSeats || 4);

      res.json({
        success: true,
        summary: globalUsageMeter.getUsageSummary(tenantId),
        invoice: globalUsageMeter.calculateMonthlyInvoice(tenantId),
      });
    }
  );

  // ============================================================================
  // 4. Native Appointments & Field-Service Calendar Dispatch Endpoints
  // ============================================================================
  router.get(
    '/:tenantId/appointments',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const status = req.query.status as string | undefined;
      const appointments = await scheduler.listAppointments(tenantId, status);
      res.json({ appointments, aiTools: APPOINTMENT_AI_TOOLS });
    }
  );

  router.get(
    '/:tenantId/appointments/slots',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const slots = await scheduler.checkAvailableSlots(tenantId, date);
      res.json({ date, slots });
    }
  );

  router.post(
    '/:tenantId/appointments',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      try {
        const appointment = await scheduler.bookAppointment({
          tenantId,
          ...req.body,
        });
        res.status(201).json({ appointment });
      } catch (err: any) {
        res.status(409).json({ error: err.message });
      }
    }
  );

  router.post(
    '/:tenantId/appointments/:appointmentId/reschedule',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, appointmentId } = req.params;
      const { scheduledStart, scheduledEnd } = req.body;
      try {
        const appointment = await scheduler.rescheduleAppointment(
          tenantId,
          appointmentId,
          scheduledStart,
          scheduledEnd
        );
        res.json({ appointment });
      } catch (err: any) {
        res.status(404).json({ error: err.message });
      }
    }
  );

  router.post(
    '/:tenantId/appointments/:appointmentId/cancel',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, appointmentId } = req.params;
      const { reason } = req.body;
      try {
        const appointment = await scheduler.cancelAppointment(tenantId, appointmentId, reason);
        res.json({ appointment });
      } catch (err: any) {
        res.status(404).json({ error: err.message });
      }
    }
  );

  // ============================================================================
  // 5. Multilingual Auto-Detection & Cross-Lingual RAG Routing Endpoints
  // ============================================================================
  router.post(
    '/:tenantId/i18n/detect',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const { utterance, dtmfDigit, businessName } = req.body;

      if (!utterance && !dtmfDigit) {
        res.status(400).json({ error: 'utterance or dtmfDigit is required.' });
        return;
      }

      const profile = languageRouter.detectAndRoute(utterance || '', {
        businessName,
        dtmfDigit,
      });

      const knowledgeHits = await retriever.search(tenantId, profile.augmentedRagQuery, {
        limit: 3,
      });

      res.json({
        profile,
        knowledgeHits,
        supportedLocales: languageRouter.listSupportedLocales(),
      });
    }
  );

  // ============================================================================
  // 6. PCI-DSS Payment Links & Masked DTMF Card Collection Endpoints
  // ============================================================================
  router.get(
    '/:tenantId/payments',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const payments = await paymentCollector.listPayments(tenantId);
      res.json({ payments });
    }
  );

  router.post(
    '/:tenantId/payments/link',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      try {
        const payment = await paymentCollector.createPaymentLink({
          tenantId,
          ...req.body,
        });
        RealtimeEventBus.publish(tenantId, 'payment.completed', {
          paymentId: payment.id,
          amountCents: payment.amountCents,
          status: payment.status,
        });
        res.status(201).json({ payment });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  router.post(
    '/:tenantId/payments/dtmf',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      try {
        const payment = await paymentCollector.processDtmfMaskedPayment({
          tenantId,
          ...req.body,
        });
        RealtimeEventBus.publish(tenantId, 'payment.completed', {
          paymentId: payment.id,
          maskedCardLast4: payment.maskedCardLast4,
          status: payment.status,
        });
        res.status(201).json({ payment });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  // ============================================================================
  // 7. Automated Post-Call & Post-Appointment CSAT Surveys Endpoints
  // ============================================================================
  router.get(
    '/:tenantId/surveys',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const result = await surveyEngine.listSurveys(tenantId);
      res.json(result);
    }
  );

  router.post(
    '/:tenantId/surveys/dispatch',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const dispatched = await surveyEngine.dispatchSurvey({
        tenantId,
        ...req.body,
      });
      res.status(201).json(dispatched);
    }
  );

  router.post(
    '/:tenantId/surveys/:surveyId/respond',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, surveyId } = req.params;
      const { score, feedbackText } = req.body;
      try {
        const result = await surveyEngine.recordSurveyResponse({
          tenantId,
          surveyId,
          score: Number(score),
          feedbackText,
        });
        if (result.supervisorAlerted) {
          RealtimeEventBus.publish(tenantId, 'supervisor.alert', {
            reason: result.recoveryAction,
            surveyId,
            score,
          });
        }
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  // ============================================================================
  // 8. AI Quality Assurance (QA) Auto-Grader & Prompt Regression Runner
  // ============================================================================
  router.post(
    '/:tenantId/eval/run',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const report = await evalRunner.runEvaluationSuite(tenantId);
      res.json(report);
    }
  );

  // ============================================================================
  // 9. Server-Sent Events (SSE) Live Dashboard Push & Event Bus
  // ============================================================================
  router.get(
    '/:tenantId/events/recent',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      res.json({ events: RealtimeEventBus.getRecentEvents(tenantId) });
    }
  );

  router.post(
    '/:tenantId/events/publish',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const { type = 'call.updated', payload = {} } = req.body;
      const evt = RealtimeEventBus.publish(tenantId, type, payload);
      res.status(201).json({ event: evt });
    }
  );

  router.get(
    '/:tenantId/events/stream',
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const initialEvent = {
        id: 'evt_connected',
        tenantId,
        type: 'stream.connected',
        timestamp: new Date().toISOString(),
      };
      res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);

      const unsubscribe = RealtimeEventBus.subscribe(tenantId, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      req.on('close', () => {
        unsubscribe();
      });
    }
  );

  // ============================================================================
  // 10. Multimodal Photo & Video Equipment Diagnostics (Qwen 2.5 VL / Llama 3.2 Vision)
  // ============================================================================
  router.post(
    '/:tenantId/diagnostics/vision',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const { imageUrlOrBase64 = 'photo_furnace_e1.jpg', customerNotes, visionModel } = req.body;
      const diagnosis = await visualDiagnostics.analyzeEquipmentImage({
        tenantId,
        imageUrlOrBase64,
        customerNotes,
        visionModel,
      });
      res.json({ diagnosis });
    }
  );

  // ============================================================================
  // 11. Workforce Management (WFM), Erlang-C SLA Forecaster & Agent Shifts
  // ============================================================================
  router.post(
    '/:tenantId/workforce/forecast',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const {
        callsPerHour = 120,
        averageHandleTimeSeconds = 180,
        targetAnswerSeconds = 20,
        targetSlaPercent = 80,
      } = req.body;

      const forecast = workforceManager.calculateErlangCStaffing({
        callsPerHour: Number(callsPerHour),
        averageHandleTimeSeconds: Number(averageHandleTimeSeconds),
        targetAnswerSeconds: Number(targetAnswerSeconds),
        targetSlaPercent: Number(targetSlaPercent),
      });
      res.json({ forecast });
    }
  );

  router.get(
    '/:tenantId/workforce/shifts',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const shiftDate = req.query.date as string | undefined;
      const shifts = await workforceManager.listShifts(tenantId, shiftDate);
      res.json({ shifts });
    }
  );

  router.post(
    '/:tenantId/workforce/shifts',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const shift = await workforceManager.createShift({
        tenantId,
        ...req.body,
      });
      res.status(201).json({ shift });
    }
  );

  // ============================================================================
  // 12. Autonomous Voicemail Drop & Answering Machine Detection (AMD)
  // ============================================================================
  router.post(
    '/:tenantId/voice/amd',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const decision = amdDetector.classifyCallAnswer(req.body);
      res.json({ decision });
    }
  );

  // ============================================================================
  // 13. Tenant Outbound Webhook Subscriptions & HMAC Event Dispatcher
  // ============================================================================
  router.get(
    '/:tenantId/webhooks/subscriptions',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const subscriptions = await webhookRegistry.listSubscriptions(tenantId);
      res.json({ subscriptions });
    }
  );

  router.post(
    '/:tenantId/webhooks/subscriptions',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const subscription = await webhookRegistry.createSubscription({
        tenantId,
        ...req.body,
      });
      res.status(201).json({ subscription });
    }
  );

  router.post(
    '/:tenantId/webhooks/dispatch',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const { eventType = 'appointment.booked', payload = {} } = req.body;
      const receipts = await webhookRegistry.dispatchEvent(tenantId, eventType, payload);
      res.json({ receipts });
    }
  );

  // ============================================================================
  // 14. Real-Time Incident Alerter (Slack, Microsoft Teams & PagerDuty)
  // ============================================================================
  router.post(
    '/:tenantId/incidents/dispatch',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const {
        title = 'Emergency Queue Wait SLA Breach',
        severity = 'critical',
        source = 'sla_queue_breach',
        callerPhone = '+15550101',
        summary = 'Emergency HVAC caller waiting > 60s in priority queue.',
      } = req.body;

      const result = await incidentDispatcher.dispatchIncident({
        tenantId,
        title,
        severity,
        source,
        callerPhone,
        summary,
      });
      res.json(result);
    }
  );

  // ============================================================================
  // 15. Open-Weights LoRA Fine-Tuning Dataset Exporter (ShareGPT / OpenAI JSONL)
  // ============================================================================
  router.get(
    '/:tenantId/ai/dataset-export',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const format = ((req.query.format as string) || 'sharegpt') as FineTuningFormat;
      const dataset = await datasetExporter.exportFineTuningDataset(tenantId, format);
      res.json(dataset);
    }
  );

  // ============================================================================
  // 16. Knowledge Base Version History, Snapshots & 1-Click Rollback
  // ============================================================================
  router.get(
    '/:tenantId/knowledge/:docId/versions',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, docId } = req.params;
      const versions = await knowledgeGovernance.listVersions(tenantId, docId);
      res.json({ versions });
    }
  );

  router.post(
    '/:tenantId/knowledge/:docId/versions',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, docId } = req.params;
      const snapshot = await knowledgeGovernance.createVersionSnapshot({
        tenantId,
        documentId: docId,
        ...req.body,
      });
      res.status(201).json({ version: snapshot });
    }
  );

  router.post(
    '/:tenantId/knowledge/:docId/rollback',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, docId } = req.params;
      const { versionNumber } = req.body;
      try {
        const result = await knowledgeGovernance.rollbackToVersion(
          tenantId,
          docId,
          Number(versionNumber)
        );
        res.json(result);
      } catch (err: any) {
        res.status(404).json({ error: err.message });
      }
    }
  );

  // ============================================================================
  // 17. Post-Call SMS & Email Follow-Up Recap Generator
  // ============================================================================
  router.post(
    '/:tenantId/calls/:callSid/followup',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, callSid } = req.params;
      const recap = await followUpComposer.composeFollowUp({
        tenantId,
        callSid,
        callerPhone: req.body.callerPhone || '+15550101',
        conversationId: req.body.conversationId,
        businessName: req.body.businessName,
      });
      res.json({ recap });
    }
  );

  // ============================================================================
  // 18. A/B Prompt & Voice Persona Experimentation Engine
  // ============================================================================
  router.get(
    '/:tenantId/experiments',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const experiments = await experimentEngine.listExperiments(tenantId);
      res.json({ experiments });
    }
  );

  router.post(
    '/:tenantId/experiments',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const experiment = await experimentEngine.createExperiment({
        tenantId,
        ...req.body,
      });
      res.status(201).json({ experiment });
    }
  );

  router.post(
    '/:tenantId/experiments/:experimentId/outcome',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, experimentId } = req.params;
      const { variant = 'A', csatScore = 5, resolved = true } = req.body;
      const experiment = await experimentEngine.recordOutcome(
        tenantId,
        experimentId,
        variant,
        { csatScore: Number(csatScore), resolved: Boolean(resolved) }
      );
      res.json({ experiment });
    }
  );

  // ============================================================================
  // 19. Real-Time PCI/HIPAA Call Audio Scrubber
  // ============================================================================
  router.post(
    '/:tenantId/security/scrub-audio',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const result = audioRedactor.scrubAudioWithWordTimestamps({
        audioBase64: req.body.audioBase64 || Buffer.alloc(1600, 0x55).toString('base64'),
        sampleRateHz: req.body.sampleRateHz,
        words: req.body.words || [],
      });
      res.json(result);
    }
  );

  // ============================================================================
  // 20. Agent Gamification, QA Scorecards & Coaching Leaderboard
  // ============================================================================
  router.get(
    '/:tenantId/workforce/leaderboard',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      res.json({ leaderboard: scorecardService.getTenantLeaderboard(tenantId) });
    }
  );

  return router;
}
