import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { SmsAdapter, SmsConversationHandler, MockAiProvider } from '@customer-service/core';

export function createSmsRouter(db: DatabaseInstance): Router {
  const router = Router();
  const defaultHandler = new SmsConversationHandler(db, new MockAiProvider());

  // POST /api/v1/sms/inbound - Twilio Inbound SMS Webhook
  router.post('/inbound', async (req: Request, res: Response): Promise<void> => {
    const payload = SmsAdapter.parseInbound(req.body);
    const queryTenantId = req.query.tenantId as string;

    // Resolve tenant by query parameter or fallback phone lookup
    let tenantId = queryTenantId;
    if (!tenantId) {
      const [settings] = await db
        .select()
        .from(schema.businessSettings)
        .where(eq(schema.businessSettings.fallbackPhone, payload.to));

      tenantId = settings?.tenantId || 'tenant_acme_hvac_001';
    }

    try {
      const result = await defaultHandler.handleInboundSms({
        tenantId,
        from: payload.from,
        to: payload.to,
        body: payload.body,
        messageSid: payload.messageSid,
      });

      res.setHeader('Content-Type', 'text/xml');
      res.send(result.twiml);
    } catch (err: any) {
      res.setHeader('Content-Type', 'text/xml');
      res.send(
        SmsAdapter.renderReply('We received your message but could not process it at this time.')
      );
    }
  });

  return router;
}
