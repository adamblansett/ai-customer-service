import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { TwimlAdapter } from '@customer-service/core';
import { VoiceCallSimulator } from '@customer-service/core';
import { MockAiProvider } from '@customer-service/core';

export function createTelephonyRouter(db: DatabaseInstance): Router {
  const router = Router();
  // Use offline deterministic provider for webhook endpoints unless BYOK is wired
  const defaultSimulator = new VoiceCallSimulator(db, new MockAiProvider());

  // POST /api/v1/voice/inbound - Twilio Inbound Voice Webhook
  router.post('/inbound', async (req: Request, res: Response): Promise<void> => {
    const { CallSid, From, To } = req.body;
    const queryTenantId = req.query.tenantId as string;

    const callSid = CallSid || `call_${Date.now()}`;
    const fromNumber = From || '+15550000';
    const toNumber = To || '+15550100';

    // Resolve tenant by query parameter or fallback phone lookup
    let tenantId = queryTenantId;
    if (!tenantId) {
      const [settings] = await db
        .select()
        .from(schema.businessSettings)
        .where(eq(schema.businessSettings.fallbackPhone, toNumber));

      tenantId = settings?.tenantId || 'tenant_acme_hvac_001';
    }

    try {
      const result = await defaultSimulator.simulateCallStart({
        tenantId,
        fromNumber,
        toNumber,
      });

      res.setHeader('Content-Type', 'text/xml');
      res.send(result.twiml);
    } catch (err: any) {
      res.setHeader('Content-Type', 'text/xml');
      res.send(
        TwimlAdapter.renderHangup({
          message: 'We are currently unable to process your call. Please try again later.',
        })
      );
    }
  });

  // POST /api/v1/voice/events - Twilio Speech Gather Webhook
  router.post('/events', async (req: Request, res: Response): Promise<void> => {
    const callSid = (req.query.callSid as string) || req.body?.CallSid;
    const speechResult = req.body?.SpeechResult || '';

    if (!callSid) {
      res.setHeader('Content-Type', 'text/xml');
      res.send(TwimlAdapter.renderHangup({ message: 'Call session error.' }));
      return;
    }

    // Lookup session
    const [callSession] = await db
      .select()
      .from(schema.callSessions)
      .where(eq(schema.callSessions.callSid, callSid));

    if (!callSession) {
      res.setHeader('Content-Type', 'text/xml');
      res.send(TwimlAdapter.renderHangup({ message: 'Session expired.' }));
      return;
    }

    try {
      const result = await defaultSimulator.simulateCallerUtterance({
        tenantId: callSession.tenantId,
        callSid,
        utterance: speechResult || 'Hello?',
      });

      res.setHeader('Content-Type', 'text/xml');
      res.send(result.twiml);
    } catch {
      res.setHeader('Content-Type', 'text/xml');
      res.send(
        TwimlAdapter.renderHangup({
          message: 'An error occurred during call processing. Goodbye.',
        })
      );
    }
  });

  // POST /api/v1/voice/transfer-status - Twilio Dial Status Webhook
  router.post('/transfer-status', async (req: Request, res: Response): Promise<void> => {
    const callSid = (req.query.callSid as string) || req.body?.CallSid;
    const dialStatus = req.body?.DialCallStatus; // 'completed', 'busy', 'no-answer', 'failed', 'canceled'

    if (!callSid) {
      res.setHeader('Content-Type', 'text/xml');
      res.send(TwimlAdapter.renderHangup({ message: 'Call completed.' }));
      return;
    }

    const [callSession] = await db
      .select()
      .from(schema.callSessions)
      .where(eq(schema.callSessions.callSid, callSid));

    if (!callSession) {
      res.setHeader('Content-Type', 'text/xml');
      res.send(TwimlAdapter.renderHangup({ message: 'Goodbye.' }));
      return;
    }

    if (dialStatus === 'completed') {
      res.setHeader('Content-Type', 'text/xml');
      res.send('<Response><Hangup/></Response>');
      return;
    }

    // Transfer failed or no answer -> Fallback to callback request capture
    const fallback = await defaultSimulator.simulateTransferFailure({
      tenantId: callSession.tenantId,
      callSid,
      failureReason: (dialStatus as 'busy' | 'no-answer' | 'timeout') || 'no-answer',
    });

    res.setHeader('Content-Type', 'text/xml');
    res.send(fallback.twiml);
  });

  return router;
}
