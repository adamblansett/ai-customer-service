import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import * as schema from '@customer-service/db/schema';
import { TwimlAdapter } from '../telephony/twiml-adapter.js';
import { SipAdapter } from '../telephony/sip-adapter.js';
import { VoiceCallSimulator } from '../telephony/simulator.js';
import { evaluateOperatingHours } from '../escalation/hours-evaluator.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import { eq } from 'drizzle-orm';

describe('Inbound Voice & Human Escalation Subsystem', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let simulator: VoiceCallSimulator;
  let tenant1Id: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenant1Id = seed.tenant1Id;
    simulator = new VoiceCallSimulator(db, new MockAiProvider());
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('TwiML XML Generation & Escaping', () => {
    it('generates compliant greeting TwiML with recording consent', () => {
      const xml = TwimlAdapter.renderGreeting({
        greeting: 'Hello & welcome to Acme!',
        recordingConsent: 'Calls may be monitored <QA>.',
        actionUrl: '/api/v1/voice/events',
      });

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<Response>');
      expect(xml).toContain('Calls may be monitored &lt;QA&gt;.');
      expect(xml).toContain('Hello &amp; welcome to Acme!');
      expect(xml).toContain('<Gather input="speech"');
      expect(xml).toContain('</Response>');
    });

    it('generates compliant human transfer TwiML', () => {
      const xml = TwimlAdapter.renderTransfer({
        destinationNumber: '+15550199',
        actionUrl: '/api/v1/voice/transfer-status',
        announcement: 'Transferring to human support.',
        timeoutSeconds: 30,
      });

      expect(xml).toContain('<Dial timeout="30"');
      expect(xml).toContain('<Number>+15550199</Number>');
      expect(xml).toContain('Transferring to human support.');
    });
  });

  describe('Business Operating Hours Evaluation', () => {
    const testHours = {
      monday: { open: '09:00', close: '17:00', closed: false },
      sunday: { open: '00:00', close: '00:00', closed: true },
    };

    it('identifies open hours correctly', () => {
      // Monday 11:30 AM EST
      const openDate = new Date('2026-10-19T11:30:00-04:00');
      const result = evaluateOperatingHours(testHours, 'America/New_York', openDate);

      expect(result.isOpen).toBe(true);
      expect(result.dayOfWeek).toBe('monday');
    });

    it('identifies closed hours and closed days', () => {
      // Monday 8:00 PM EST (Closed)
      const afterHoursDate = new Date('2026-10-19T20:00:00-04:00');
      const res1 = evaluateOperatingHours(testHours, 'America/New_York', afterHoursDate);
      expect(res1.isOpen).toBe(false);

      // Sunday (Closed day)
      const sundayDate = new Date('2026-10-18T14:00:00-04:00');
      const res2 = evaluateOperatingHours(testHours, 'America/New_York', sundayDate);
      expect(res2.isOpen).toBe(false);
    });
  });

  describe('Full Inbound Voice Call Lifecycle Simulation', () => {
    let activeCallSid: string;

    it('simulates inbound call setup with initial greeting and callSession creation', async () => {
      const call = await simulator.simulateCallStart({
        tenantId: tenant1Id,
        fromNumber: '+15550101',
        toNumber: '+15550100',
      });

      expect(call.callSid).toBeDefined();
      expect(call.callStatus).toBe('in-progress');
      expect(call.twiml).toContain('<Gather input="speech"');
      expect(call.twiml).toContain('Acme Heating and Air Conditioning');

      activeCallSid = call.callSid;

      // Verify call session record in DB
      const [session] = await db
        .select()
        .from(schema.callSessions)
        .where(eq(schema.callSessions.callSid, activeCallSid));

      expect(session).toBeDefined();
      expect(session.fromNumber).toBe('+15550101');
      expect(session.toNumber).toBe('+15550100');
    });

    it('simulates conversational turn: answering inquiry using knowledge', async () => {
      const turn = await simulator.simulateCallerUtterance({
        tenantId: tenant1Id,
        callSid: activeCallSid,
        utterance: 'What are your standard business hours?',
      });

      expect(turn.transferInitiated).toBe(false);
      expect(turn.aiResponseText).toContain('8:00 AM to 6:00 PM');
      expect(turn.twiml).toContain('<Say voice="Polly.Joanna-Neural">');
    });

    it('simulates escalation during business hours: initiates transfer to fallback phone', async () => {
      // Simulate during open hours: Monday at 11:00 AM
      const openTime = new Date('2026-10-19T11:00:00-04:00');

      const transferTurn = await simulator.simulateCallerUtterance({
        tenantId: tenant1Id,
        callSid: activeCallSid,
        utterance: 'I really need to speak with a human representative please.',
        evaluationTime: openTime,
      });

      expect(transferTurn.transferInitiated).toBe(true);
      expect(transferTurn.callStatus).toBe('transferring');
      expect(transferTurn.twiml).toContain('<Dial timeout="30"');
      expect(transferTurn.twiml).toContain('<Number>+15550199</Number>');
    });

    it('simulates failed transfer fallback: captures callback request and confirms with caller', async () => {
      const failureResult = await simulator.simulateTransferFailure({
        tenantId: tenant1Id,
        callSid: activeCallSid,
        failureReason: 'no-answer',
      });

      expect(failureResult.callbackId).toBeDefined();
      expect(failureResult.message).toContain('callback request');
      expect(failureResult.twiml).toContain('<Hangup/>');

      // Verify callback request created in DB
      const [callback] = await db
        .select()
        .from(schema.callbackRequests)
        .where(eq(schema.callbackRequests.id, failureResult.callbackId));

      expect(callback).toBeDefined();
      expect(callback.phoneNumber).toBe('+15550101');
      expect(callback.status).toBe('pending');
    });

    it('simulates after-hours call transfer request: schedules callback immediately', async () => {
      // Start a fresh call
      const afterHoursCall = await simulator.simulateCallStart({
        tenantId: tenant1Id,
        fromNumber: '+15550102',
        toNumber: '+15550100',
      });

      // After hours: Sunday at 10:00 PM
      const closedTime = new Date('2026-10-18T22:00:00-04:00');

      const turn = await simulator.simulateCallerUtterance({
        tenantId: tenant1Id,
        callSid: afterHoursCall.callSid,
        utterance: 'Please transfer me to someone.',
        evaluationTime: closedTime,
      });

      expect(turn.transferInitiated).toBe(false);
      expect(turn.callbackCreated).toBe(true);
      expect(turn.aiResponseText).toContain('closed');
      expect(turn.twiml).toContain('<Hangup/>');
    });

    it('simulates caller hangup and duration calculation', async () => {
      await simulator.simulateCallEnd({
        tenantId: tenant1Id,
        callSid: activeCallSid,
        durationSeconds: 125,
      });

      const [session] = await db
        .select()
        .from(schema.callSessions)
        .where(eq(schema.callSessions.callSid, activeCallSid));

      expect(session.callStatus).toBe('completed');
      expect(session.durationSeconds).toBe(125);
    });
  });

  describe('SIP/PBX Event Normalization', () => {
    it('normalizes Asterisk/FreeSWITCH SIP INVITE to standard payload', () => {
      const normalized = SipAdapter.normalizeSipEvent({
        sipCallId: 'ast-12345-6789',
        eventType: 'INVITE',
        callerUri: 'sip:+15550199@pbx.company.com',
        calleeUri: 'sip:+15550100@pbx.company.com',
      });

      expect(normalized.callSid).toBe('sip_ast-12345-6789');
      expect(normalized.provider).toBe('sip');
      expect(normalized.from).toBe('+15550199');
      expect(normalized.to).toBe('+15550100');
      expect(normalized.callStatus).toBe('ringing');
    });
  });
});
