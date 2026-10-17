import { describe, it, expect } from 'vitest';
import { TelnyxAdapter, PlivoAdapter } from '../telephony/index.js';

describe('TelnyxAdapter', () => {
  it('should parse inbound call webhook payload correctly', () => {
    const rawPayload = {
      data: {
        event_type: 'call.initiated',
        id: 'evt_123',
        payload: {
          call_control_id: 'v3:call_ctrl_abc',
          call_leg_id: 'leg_def',
          direction: 'incoming',
          from: '+15551234567',
          to: '+18005550199',
        },
      },
    };

    const parsed = TelnyxAdapter.parseWebhook(rawPayload);
    expect(parsed.callControlId).toBe('v3:call_ctrl_abc');
    expect(parsed.callLegId).toBe('leg_def');
    expect(parsed.eventType).toBe('call.initiated');
    expect(parsed.from).toBe('+15551234567');
    expect(parsed.to).toBe('+18005550199');
    expect(parsed.direction).toBe('inbound');
  });

  it('should build speak command payload', () => {
    const cmd = TelnyxAdapter.buildSpeakCommand({
      payloadText: 'Hello, welcome to support.',
      voice: 'female',
      language: 'en-US',
    });

    expect(cmd).toEqual({
      payload: 'Hello, welcome to support.',
      voice: 'female',
      language: 'en-US',
      payload_type: 'text',
    });
  });

  it('should build transfer command payload', () => {
    const cmd = TelnyxAdapter.buildTransferCommand('+15559876543');
    expect(cmd).toEqual({
      to: '+15559876543',
      time_limit_secs: 60,
      timeout_secs: 30,
    });
  });

  it('should build gather using speak command', () => {
    const cmd = TelnyxAdapter.buildGatherUsingSpeakCommand({
      payloadText: 'Press 1 for sales or 2 for support',
    });
    expect(cmd.payload).toBe('Press 1 for sales or 2 for support');
    expect(cmd.maximum_digits).toBe(1);
    expect(cmd.timeout_millis).toBe(5000);
  });
});

describe('PlivoAdapter', () => {
  it('should parse incoming Plivo call webhook parameters', () => {
    const body = {
      CallUUID: 'plivo-call-uuid-999',
      From: '+15551234567',
      To: '+18005550199',
      Direction: 'inbound',
      CallStatus: 'in-progress',
      Digits: '1',
      Speech: 'speak to billing',
    };

    const parsed = PlivoAdapter.parseWebhook(body);
    expect(parsed.callUuid).toBe('plivo-call-uuid-999');
    expect(parsed.from).toBe('+15551234567');
    expect(parsed.to).toBe('+18005550199');
    expect(parsed.direction).toBe('inbound');
    expect(parsed.callStatus).toBe('in-progress');
    expect(parsed.digits).toBe('1');
    expect(parsed.speech).toBe('speak to billing');
  });

  it('should render speak response XML with digits gathering', () => {
    const xml = PlivoAdapter.renderSpeakResponse({
      message: 'Welcome to Acme & Co! Press 1 or 2.',
      actionUrl: '/api/v1/plivo/gather?step=1',
    });

    expect(xml).toContain('<Response>');
    expect(xml).toContain('<GetDigits action="/api/v1/plivo/gather?step=1"');
    expect(xml).toContain('Welcome to Acme &amp; Co! Press 1 or 2.');
    expect(xml).toContain('</Response>');
  });

  it('should render dial transfer XML', () => {
    const xml = PlivoAdapter.renderDialTransfer({
      toNumber: '+15559876543',
      callerId: '+18005550199',
    });

    expect(xml).toContain('<Dial callerId="+18005550199">');
    expect(xml).toContain('<Number>+15559876543</Number>');
    expect(xml).toContain('Please hold while we transfer your call.');
  });

  it('should render hangup XML', () => {
    const xml = PlivoAdapter.renderHangup('Thank you for calling. Goodbye.');
    expect(xml).toContain('<Speak voice="WOMAN">Thank you for calling. Goodbye.</Speak>');
    expect(xml).toContain('<Hangup/>');
  });
});
