import { Router, Request, Response } from 'express';
import type { DatabaseInstance } from '@customer-service/db';
import { authMiddleware, requireTenantRole } from '../middleware/auth.js';
import {
  StripeBillingService,
  OnboardingService,
  type IndustryTemplateId,
  EcommerceConnectorService,
  TicketingConnectorService,
  CalendarSyncService,
  DistributedTracer,
} from '@customer-service/core';

export function createSaasConnectorsRouter(db: DatabaseInstance): Router {
  const router = Router();
  const stripeBilling = new StripeBillingService(db);
  const onboarding = new OnboardingService(db);
  const ecommerce = new EcommerceConnectorService(db);
  const ticketing = new TicketingConnectorService(db);
  const calendarSync = new CalendarSyncService(db);
  const tracer = new DistributedTracer(db);

  // ============================================================================
  // 1. Stripe SaaS Checkout, Portal & Metered Sync
  // ============================================================================
  router.get(
    '/:tenantId/billing/stripe',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const subscription = await stripeBilling.getTenantSubscription(req.params.tenantId);
      res.json({ subscription });
    }
  );

  router.post(
    '/:tenantId/billing/stripe/checkout',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId } = req.params;
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await stripeBilling.createCheckoutSession({
        tenantId,
        tier: req.body?.tier || 'pro',
        customerEmail: req.user?.email,
        successUrl: req.body?.successUrl || `${origin}/billing?checkout=success`,
        cancelUrl: req.body?.cancelUrl || `${origin}/billing?checkout=cancelled`,
      });
      res.status(201).json(session);
    }
  );

  router.post(
    '/:tenantId/billing/stripe/portal',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const origin = `${req.protocol}://${req.get('host')}`;
      const portal = await stripeBilling.createCustomerPortalSession(
        req.params.tenantId,
        req.body?.returnUrl || `${origin}/billing`
      );
      res.json(portal);
    }
  );

  router.post(
    '/:tenantId/billing/stripe/sync-usage',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const synced = await stripeBilling.syncMeteredUsage({
        tenantId: req.params.tenantId,
        voiceMinutes: Number(req.body?.voiceMinutes || 0),
        aiTokens: Number(req.body?.aiTokens || 0),
      });
      res.json(synced);
    }
  );

  // ============================================================================
  // 2. Guided Industry Template Application
  // ============================================================================
  router.post(
    '/:tenantId/onboarding/template',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const industry = (req.body?.industry || 'hvac') as IndustryTemplateId;
      const result = await onboarding.applyIndustryTemplate(req.params.tenantId, industry);
      res.json(result);
    }
  );

  // ============================================================================
  // 3. E-Commerce Order Connectors (Shopify & WooCommerce)
  // ============================================================================
  router.get(
    '/:tenantId/connectors/orders',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const orders = await ecommerce.listOrders(req.params.tenantId);
      res.json({ orders });
    }
  );

  router.post(
    '/:tenantId/connectors/orders',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const order = await ecommerce.upsertOrder({
        tenantId: req.params.tenantId,
        ...req.body,
      });
      res.status(201).json({ order });
    }
  );

  router.post(
    '/:tenantId/connectors/webhooks/:provider',
    async (req: Request, res: Response): Promise<void> => {
      const provider = req.params.provider === 'woocommerce' ? 'woocommerce' : 'shopify';
      const order = await ecommerce.ingestWebhookOrder(
        req.params.tenantId,
        provider,
        req.body || {}
      );
      res.status(201).json({ synced: true, provider, order });
    }
  );

  // ============================================================================
  // 4. Helpdesk & ITSM Connectors (Zendesk, Jira, ServiceNow)
  // ============================================================================
  router.get(
    '/:tenantId/connectors/tickets',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const tickets = await ticketing.listTickets(req.params.tenantId);
      res.json({ tickets });
    }
  );

  router.post(
    '/:tenantId/connectors/tickets',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const ticket = await ticketing.createTicket({
        tenantId: req.params.tenantId,
        ...req.body,
      });
      res.status(201).json({ ticket });
    }
  );

  router.patch(
    '/:tenantId/connectors/tickets/:externalKey',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const updated = await ticketing.updateTicketStatus(
        req.params.tenantId,
        req.params.externalKey,
        req.body?.status || 'resolved'
      );
      if (!updated) {
        res.status(404).json({ error: 'Ticket not found.' });
        return;
      }
      res.json({ ticket: updated });
    }
  );

  // ============================================================================
  // 5. Two-Way Technician Calendar Sync (Google Calendar & M365 + RFC 5545 .ics)
  // ============================================================================
  router.get(
    '/:tenantId/connectors/calendars',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const connections = await calendarSync.listConnections(req.params.tenantId);
      res.json({ connections });
    }
  );

  router.post(
    '/:tenantId/connectors/calendars',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin']),
    async (req: Request, res: Response): Promise<void> => {
      const connection = await calendarSync.connectCalendar({
        tenantId: req.params.tenantId,
        ...req.body,
      });
      res.status(201).json({ connection });
    }
  );

  router.get(
    '/:tenantId/appointments/ical.ics',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const ics = await calendarSync.exportIcalFeed(req.params.tenantId);
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.send(ics);
    }
  );

  // ============================================================================
  // 6. OpenTelemetry Distributed Trace Waterfall Endpoints
  // ============================================================================
  router.get(
    '/:tenantId/traces',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      let traces = await tracer.listRecentTraces(req.params.tenantId, 15);
      if (traces.length === 0) {
        // Seed one realistic voice pipeline waterfall on first inspection so the console is immediately informative
        await tracer.recordVoiceTurnWaterfall({
          tenantId: req.params.tenantId,
          sttMs: 118,
          ragMs: 24,
          llmMs: 286,
          toolMs: 39,
          dlpMs: 2,
          ttsMs: 94,
          model: 'qwen2.5:7b-instruct',
        });
        traces = await tracer.listRecentTraces(req.params.tenantId, 15);
      }
      res.json({ traces });
    }
  );

  router.post(
    '/:tenantId/traces/record-turn',
    authMiddleware,
    requireTenantRole(db, ['owner', 'admin', 'agent']),
    async (req: Request, res: Response): Promise<void> => {
      const recorded = await tracer.recordVoiceTurnWaterfall({
        tenantId: req.params.tenantId,
        conversationId: req.body?.conversationId,
        traceId: (req as any).traceId,
        sttMs: Number(req.body?.sttMs ?? 112),
        ragMs: Number(req.body?.ragMs ?? 19),
        llmMs: Number(req.body?.llmMs ?? 245),
        toolMs: req.body?.toolMs ? Number(req.body.toolMs) : undefined,
        dlpMs: Number(req.body?.dlpMs ?? 1),
        ttsMs: Number(req.body?.ttsMs ?? 88),
        model: req.body?.model || 'qwen2.5:7b-instruct',
      });
      res.status(201).json(recorded);
    }
  );

  return router;
}
