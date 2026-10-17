import { Router, Request, Response } from 'express';
import type { DatabaseInstance } from '@customer-service/db';
import {
  WhatsAppAdapter,
  WhatsAppConversationHandler,
  MockAiProvider,
} from '@customer-service/core';

export function createWhatsAppRouter(db: DatabaseInstance): Router {
  const router = Router();
  const defaultHandler = new WhatsAppConversationHandler(db, new MockAiProvider());
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'customer_service_wa_verify_token';

  // GET /api/v1/whatsapp/webhook - Meta Graph API Webhook Verification Handshake
  router.get('/webhook', (req: Request, res: Response): void => {
    const verification = WhatsAppAdapter.verifyWebhook(req.query, verifyToken);
    if (verification.isValid && verification.challenge) {
      res.status(200).send(verification.challenge);
    } else {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Verification token mismatch' });
    }
  });

  // POST /api/v1/whatsapp/webhook - Inbound WhatsApp Message Notification
  router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
    const messages = WhatsAppAdapter.parseInbound(req.body);
    const tenantId = (req.query.tenantId as string) || 'tenant_acme_hvac_001';

    const replies = [];
    for (const msg of messages) {
      try {
        const result = await defaultHandler.handleInbound(tenantId, msg);
        replies.push({
          messageId: msg.id,
          conversationId: result.conversationId,
          responsePayload: result.responsePayload,
        });
      } catch (err: any) {
        replies.push({
          messageId: msg.id,
          error: err.message,
        });
      }
    }

    res.status(200).json({ status: 'received', processed: replies.length, replies });
  });

  return router;
}
