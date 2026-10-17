import { Router, Request, Response } from 'express';
import type { DatabaseInstance } from '@customer-service/db';
import { EmailAdapter, EmailConversationHandler, MockAiProvider } from '@customer-service/core';

export function createEmailRouter(db: DatabaseInstance): Router {
  const router = Router();
  const defaultHandler = new EmailConversationHandler(db, new MockAiProvider());

  // POST /api/v1/email/inbound - Inbound Email Webhook (SendGrid, Postmark, Mailgun)
  router.post('/inbound', async (req: Request, res: Response): Promise<void> => {
    const payload = EmailAdapter.parseInbound(req.body);
    const tenantId = (req.query.tenantId as string) || 'tenant_acme_hvac_001';

    try {
      const result = await defaultHandler.handleInbound(tenantId, payload);
      res.status(200).json({
        status: 'delivered',
        conversationId: result.conversationId,
        reply: {
          to: result.to,
          from: result.from,
          subject: result.subject,
          text: result.text,
        },
      });
    } catch (err: any) {
      res.status(400).json({
        error: 'EMAIL_PROCESSING_FAILED',
        message: err.message,
      });
    }
  });

  return router;
}
