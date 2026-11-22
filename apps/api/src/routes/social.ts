import { Router, Request, Response } from 'express';
import type { DatabaseInstance } from '@customer-service/db';
import {
  SocialChannelGateway,
  type SocialChannelKind,
  StripeBillingService,
} from '@customer-service/core';

const VALID_SOCIAL_CHANNELS = new Set<SocialChannelKind>([
  'apple_business',
  'instagram_dm',
  'facebook_messenger',
  'slack_connect',
]);

export function createSocialAndWebhooksRouter(db: DatabaseInstance): Router {
  const router = Router();
  const socialGateway = new SocialChannelGateway(db);
  const stripeBilling = new StripeBillingService(db);

  // POST /api/v1/stripe/webhook - Signed Stripe Webhook Receiver
  router.post('/stripe/webhook', async (req: Request, res: Response): Promise<void> => {
    try {
      const signature = req.headers['stripe-signature'] as string | undefined;
      const rawPayload =
        typeof (req as any).rawBody === 'string'
          ? (req as any).rawBody
          : JSON.stringify(req.body || {});
      const event = stripeBilling.verifyWebhookSignature(rawPayload, signature || '');
      const result = await stripeBilling.handleWebhookEvent(event);
      res.json({ received: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Invalid Stripe webhook signature.' });
    }
  });

  // POST /api/v1/social/:tenantId/:channel - Apple Messages, Instagram DM, Messenger, Slack Connect
  router.post(
    '/social/:tenantId/:channel',
    async (req: Request, res: Response): Promise<void> => {
      const { tenantId, channel } = req.params;
      if (!VALID_SOCIAL_CHANNELS.has(channel as SocialChannelKind)) {
        res.status(400).json({ error: `Unsupported social channel: ${channel}` });
        return;
      }

      // Slack Events API URL verification challenge
      if (channel === 'slack_connect' && req.body?.type === 'url_verification') {
        res.json({ challenge: req.body.challenge });
        return;
      }

      // Enforce Slack signature if configured
      if (channel === 'slack_connect' && process.env.SLACK_SIGNING_SECRET) {
        const ts = String(req.headers['x-slack-request-timestamp'] || '');
        const sig = String(req.headers['x-slack-signature'] || '');
        const valid = SocialChannelGateway.verifySlackSignature(
          JSON.stringify(req.body || {}),
          ts,
          sig,
          process.env.SLACK_SIGNING_SECRET
        );
        if (!valid) {
          res.status(401).json({ error: 'Invalid Slack HMAC signature.' });
          return;
        }
      }

      // Enforce Meta Hub signature if configured
      if (
        (channel === 'instagram_dm' || channel === 'facebook_messenger') &&
        process.env.META_APP_SECRET
      ) {
        const sig = String(req.headers['x-hub-signature-256'] || '');
        const valid = SocialChannelGateway.verifyMetaHubSignature(
          JSON.stringify(req.body || {}),
          sig,
          process.env.META_APP_SECRET
        );
        if (!valid) {
          res.status(401).json({ error: 'Invalid Meta X-Hub-Signature-256.' });
          return;
        }
      }

      const parsed = socialGateway.parseInboundWebhook(
        channel as SocialChannelKind,
        req.body || {}
      );
      if (!parsed) {
        res.status(200).json({ ok: true, ignored: true });
        return;
      }

      const handled = await socialGateway.handleInboundSocialMessage(tenantId, parsed);
      res.status(200).json(handled);
    }
  );

  return router;
}
