import { describe, it, expect, vi } from 'vitest';
import {
  MockSpeechProvider,
  SpeechPipeline,
  MediaStreamSession,
  DeepgramSttProvider,
  ElevenLabsTtsProvider,
  WebSocketLike,
} from '../telephony/index.js';

describe('Streaming Speech-to-Text & Text-to-Speech Engine', () => {
  it('transcribes and synthesizes audio with MockSpeechProvider', async () => {
    const provider = new MockSpeechProvider({
      cannedTranscript: 'My AC is blowing warm air.',
      cannedAudioBase64: 'YXVkaW9fcmVzcG9uc2Vfc2FtcGxl',
    });

    const transcription = await provider.transcribeAudio('aW5ib3VuZF9hdWRpb19mcmFtZQ==');
    expect(transcription.text).toBe('My AC is blowing warm air.');
    expect(transcription.confidence).toBeGreaterThan(0.9);
    expect(transcription.isFinal).toBe(true);

    const synthesis = await provider.synthesizeSpeech('I will help you diagnose the cooling issue.');
    expect(synthesis.audioBase64).toBe('YXVkaW9fcmVzcG9uc2Vfc2FtcGxl');
    expect(synthesis.format).toBe('audio/x-mulaw');
    expect(synthesis.durationMs).toBeGreaterThan(0);
  });

  it('orchestrates full-duplex speech pipeline with MediaStreamSession', async () => {
    const sentMessages: string[] = [];
    const mockSocket: WebSocketLike = {
      send: (data: string) => {
        sentMessages.push(data);
      },
      close: vi.fn(),
    };

    const session = new MediaStreamSession({
      streamSid: 'MZ_speech_pipeline_001',
      callSid: 'CA_speech_pipeline_001',
      tenantId: 'tenant_acme_hvac_001',
      protocol: 'twilio',
      socket: mockSocket,
    });

    const mockSpeech = new MockSpeechProvider({
      cannedTranscript: 'Can I schedule a furnace maintenance visit?',
      cannedAudioBase64: 'cGxheWJhY2tfdHRzX2ZpbGU=',
    });

    const pipeline = new SpeechPipeline({
      session,
      stt: mockSpeech,
      tts: mockSpeech,
    });

    // 1. Ingest audio chunks from caller
    session.handleInboundMedia('Y2h1bmsx');
    session.handleInboundMedia('Y2h1bmsy');

    // 2. Process transcription
    const transcript = await pipeline.processTranscription();
    expect(transcript.text).toBe('Can I schedule a furnace maintenance visit?');

    // 3. Speak assistant reply back to caller over stream
    const speechResult = await pipeline.speakText('Sure! Let me check availability for tomorrow.');
    expect(speechResult.audioBase64).toBe('cGxheWJhY2tfdHRzX2ZpbGU=');

    // Verify audio frame was dispatched to socket
    const outboundMedia = sentMessages.find((m) => JSON.parse(m).event === 'media');
    expect(outboundMedia).toBeDefined();
    const parsedMedia = JSON.parse(outboundMedia!);
    expect(parsedMedia.media.payload).toBe('cGxheWJhY2tfdHRzX2ZpbGU=');

    // 4. Test interruption: caller barge-in cancels buffer and triggers event
    let interruptedEmitted = false;
    pipeline.on('interrupted', () => {
      interruptedEmitted = true;
    });

    session.interrupt();
    expect(interruptedEmitted).toBe(true);
  });

  it('validates API key presence for external Deepgram and ElevenLabs providers', async () => {
    const deepgram = new DeepgramSttProvider({ apiKey: '' });
    await expect(deepgram.transcribeAudio('sample')).rejects.toThrow(/API key is missing/);

    const elevenLabs = new ElevenLabsTtsProvider({ apiKey: '' });
    await expect(elevenLabs.synthesizeSpeech('sample')).rejects.toThrow(/API key is missing/);
  });
});
