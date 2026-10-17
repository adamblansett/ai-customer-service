import { EventEmitter } from 'node:events';
import { MediaStreamSession, StreamMediaFormat } from './streams.js';

export interface SttTranscriptionResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  language?: string;
}

export interface TtsSynthesisResult {
  audioBase64: string;
  format: 'audio/x-mulaw' | 'audio/mp3' | 'audio/wav';
  durationMs?: number;
}

export interface SttProvider {
  readonly providerId: string;
  transcribeAudio(audioBase64: string, format?: StreamMediaFormat): Promise<SttTranscriptionResult>;
}

export interface TtsProvider {
  readonly providerId: string;
  synthesizeSpeech(text: string, voice?: string): Promise<TtsSynthesisResult>;
}

/**
 * Deterministic Mock Speech Provider for offline verification and local testing.
 */
export class MockSpeechProvider implements SttProvider, TtsProvider {
  public readonly providerId = 'mock_speech';
  private cannedTranscript: string;
  private cannedAudioBase64: string;

  constructor(options?: { cannedTranscript?: string; cannedAudioBase64?: string }) {
    this.cannedTranscript = options?.cannedTranscript || 'Hello, I need help with my heating system.';
    this.cannedAudioBase64 = options?.cannedAudioBase64 || 'bXVMYXdBdWRpb1NhbXBsZQ=='; // 'muLawAudioSample' base64
  }

  public async transcribeAudio(
    _audioBase64: string,
    _format?: StreamMediaFormat
  ): Promise<SttTranscriptionResult> {
    return {
      text: this.cannedTranscript,
      isFinal: true,
      confidence: 0.98,
      language: 'en-US',
    };
  }

  public async synthesizeSpeech(text: string, _voice?: string): Promise<TtsSynthesisResult> {
    // Generate simulated audio output
    return {
      audioBase64: this.cannedAudioBase64,
      format: 'audio/x-mulaw',
      durationMs: Math.min(text.length * 50, 3000),
    };
  }
}

/**
 * Deepgram Nova-2 / WebSocket STT Provider interface.
 */
export class DeepgramSttProvider implements SttProvider {
  public readonly providerId = 'deepgram';
  private apiKey: string;
  private model: string;

  constructor(options: { apiKey: string; model?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'nova-2';
  }

  public async transcribeAudio(
    audioBase64: string,
    format?: StreamMediaFormat
  ): Promise<SttTranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('Deepgram API key is missing.');
    }

    const encoding = format?.encoding === 'audio/x-mulaw' ? 'mulaw' : 'linear16';
    const sampleRate = format?.sampleRate || 8000;

    const url = `https://api.deepgram.com/v1/listen?model=${this.model}&encoding=${encoding}&sample_rate=${sampleRate}`;
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'audio/raw',
      },
      body: audioBuffer,
    });

    if (!res.ok) {
      throw new Error(`Deepgram STT failed with status ${res.status}`);
    }

    const data: any = await res.json();
    const transcript =
      data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    const confidence =
      data.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0.9;

    return {
      text: transcript,
      isFinal: true,
      confidence,
    };
  }
}

/**
 * ElevenLabs Streaming / REST TTS Provider.
 */
export class ElevenLabsTtsProvider implements TtsProvider {
  public readonly providerId = 'elevenlabs';
  private apiKey: string;
  private defaultVoiceId: string;

  constructor(options: { apiKey: string; voiceId?: string }) {
    this.apiKey = options.apiKey;
    this.defaultVoiceId = options.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel
  }

  public async synthesizeSpeech(text: string, voice?: string): Promise<TtsSynthesisResult> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key is missing.');
    }

    const voiceId = voice || this.defaultVoiceId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=ulaw_8000`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
      }),
    });

    if (!res.ok) {
      throw new Error(`ElevenLabs TTS failed with status ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      audioBase64: base64,
      format: 'audio/x-mulaw',
    };
  }
}

/**
 * SpeechPipeline orchestrates full duplex audio between MediaStreamSession, STT, and TTS.
 */
export class SpeechPipeline extends EventEmitter {
  private session: MediaStreamSession;
  private stt: SttProvider;
  private tts: TtsProvider;
  private audioBuffer: string[] = [];

  constructor(options: {
    session: MediaStreamSession;
    stt: SttProvider;
    tts: TtsProvider;
  }) {
    super();
    this.session = options.session;
    this.stt = options.stt;
    this.tts = options.tts;

    this.session.on('audio', (chunk) => {
      this.handleIncomingChunk(chunk.payload);
    });

    this.session.on('bargeIn', () => {
      this.audioBuffer = [];
      this.emit('interrupted');
    });
  }

  private handleIncomingChunk(chunkBase64: string): void {
    this.audioBuffer.push(chunkBase64);
    // Emit chunk accumulated event
    this.emit('audioBuffered', { totalChunks: this.audioBuffer.length });
  }

  /**
   * Finalizes buffered audio and transcribes it via STT provider.
   */
  public async processTranscription(): Promise<SttTranscriptionResult> {
    const combined = this.audioBuffer.join('');
    this.audioBuffer = [];

    const result = await this.stt.transcribeAudio(combined, this.session.mediaFormat);
    this.emit('transcribed', result);
    return result;
  }

  /**
   * Converts assistant text response into speech and plays it over the media stream.
   */
  public async speakText(text: string, voice?: string): Promise<TtsSynthesisResult> {
    const result = await this.tts.synthesizeSpeech(text, voice);
    this.session.sendAudio(result.audioBase64);
    this.emit('spoke', { text, durationMs: result.durationMs });
    return result;
  }
}
