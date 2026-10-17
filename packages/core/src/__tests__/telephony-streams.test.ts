import { describe, it, expect, vi } from 'vitest';
import {
  MediaStreamGateway,
  MediaStreamSession,
  TwimlAdapter,
  WebSocketLike,
} from '../telephony/index.js';

describe('Bidirectional Telephony Media Stream Gateway', () => {
  it('renders valid TwiML Connect Stream XML', () => {
    const xml = TwimlAdapter.renderMediaStream({
      streamUrl: 'wss://api.example.com/api/v1/voice/stream',
      customParameters: {
        tenantId: 'tenant_acme_hvac_001',
        callerId: '+15551234567',
      },
    });

    expect(xml).toContain('<Connect>');
    expect(xml).toContain('<Stream url="wss://api.example.com/api/v1/voice/stream">');
    expect(xml).toContain('<Parameter name="tenantId" value="tenant_acme_hvac_001"/>');
    expect(xml).toContain('<Parameter name="callerId" value="+15551234567"/>');
  });

  it('manages Twilio media stream lifecycle: connect, start, media, mark, stop', () => {
    const gateway = new MediaStreamGateway();
    const sentMessages: string[] = [];

    const mockSocket: WebSocketLike = {
      send: (data: string) => {
        sentMessages.push(data);
      },
      close: vi.fn(),
    };

    // 1. Send 'connected' event
    gateway.handleMessage(mockSocket, JSON.stringify({
      event: 'connected',
      protocol: 'Call',
      version: '1.0.0',
    }));

    expect(gateway.getActiveCount()).toBe(0);

    // 2. Send 'start' event
    const session = gateway.handleMessage(mockSocket, JSON.stringify({
      event: 'start',
      sequenceNumber: '1',
      start: {
        streamSid: 'MZ1234567890abcdef',
        accountSid: 'AC1234567890',
        callSid: 'CA1234567890',
        tracks: ['inbound'],
        customParameters: {
          tenantId: 'tenant_acme_hvac_001',
        },
      },
    }));

    expect(session).toBeDefined();
    expect(session?.streamSid).toBe('MZ1234567890abcdef');
    expect(session?.callSid).toBe('CA1234567890');
    expect(session?.tenantId).toBe('tenant_acme_hvac_001');
    expect(gateway.getActiveCount()).toBe(1);

    // 3. Receive inbound audio chunk
    let receivedPayload = '';
    session?.on('audio', (data) => {
      receivedPayload = data.payload;
    });

    gateway.handleMessage(mockSocket, JSON.stringify({
      event: 'media',
      streamSid: 'MZ1234567890abcdef',
      sequenceNumber: '2',
      media: {
        track: 'inbound',
        chunk: '1',
        timestamp: '100',
        payload: 'dGVzdGF1ZGlv', // 'testaudio' in base64
      },
    }));

    expect(receivedPayload).toBe('dGVzdGF1ZGlv');
    expect(session?.getStats().inboundChunkCount).toBe(1);

    // 4. Send outbound audio to caller
    session?.sendAudio('b3V0Ym91bmRhZGlv');
    expect(sentMessages.length).toBe(1);
    const parsedOutbound = JSON.parse(sentMessages[0]);
    expect(parsedOutbound.event).toBe('media');
    expect(parsedOutbound.streamSid).toBe('MZ1234567890abcdef');
    expect(parsedOutbound.media.payload).toBe('b3V0Ym91bmRhZGlv');

    // 5. Send mark event
    session?.sendMark('greeting_completed');
    expect(sentMessages.length).toBe(2);
    const parsedMark = JSON.parse(sentMessages[1]);
    expect(parsedMark.event).toBe('mark');
    expect(parsedMark.mark.name).toBe('greeting_completed');

    // 6. Stop event
    gateway.handleMessage(mockSocket, JSON.stringify({
      event: 'stop',
      streamSid: 'MZ1234567890abcdef',
      sequenceNumber: '3',
      stop: {
        accountSid: 'AC1234567890',
        callSid: 'CA1234567890',
      },
    }));

    expect(session?.getStats().isClosed).toBe(true);
    expect(gateway.getActiveCount()).toBe(0);
  });

  it('triggers barge-in interruption when caller speaks during active outbound audio', () => {
    const sentMessages: string[] = [];
    const mockSocket: WebSocketLike = {
      send: (data: string) => {
        sentMessages.push(data);
      },
      close: vi.fn(),
    };

    const session = new MediaStreamSession({
      streamSid: 'MZ_bargein_test',
      callSid: 'CA_bargein_test',
      tenantId: 'tenant_acme',
      protocol: 'twilio',
      socket: mockSocket,
    });

    let bargeInDetected = false;
    session.on('bargeIn', () => {
      bargeInDetected = true;
    });

    // Start playing audio to caller
    session.sendAudio('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=');
    expect(session.getStats().isStreamingToCaller).toBe(true);

    // Caller interrupts with substantial speech audio
    const longAudioPayload = 'A'.repeat(80);
    session.handleInboundMedia(longAudioPayload);

    // Verifies barge-in:
    expect(bargeInDetected).toBe(true);
    expect(session.getStats().isStreamingToCaller).toBe(false);

    // Verifies 'clear' message was dispatched to telephony provider
    const clearMessage = sentMessages.find((m) => JSON.parse(m).event === 'clear');
    expect(clearMessage).toBeDefined();
    const parsedClear = JSON.parse(clearMessage!);
    expect(parsedClear.streamSid).toBe('MZ_bargein_test');
  });
});
