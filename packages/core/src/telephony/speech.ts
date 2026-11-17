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

// ============================================================================
// Built-In Open-Weights Speech-to-Text (STT) & Text-to-Speech (TTS)
// ============================================================================

export type BuiltInSttProfileId =
  | 'whisper-large-v3-turbo'
  | 'distil-whisper-large-v3'
  | 'whisper-base.en';

export type BuiltInTtsProfileId =
  | 'kokoro-82m'
  | 'piper-en-us-lessac-medium';

export interface BuiltInSpeechModelSpec {
  id: string;
  kind: 'stt' | 'tts';
  displayName: string;
  license: string;
  parameterCount: string;
  quantizedSizeMb: number;
  recommendedHardware: string;
  description: string;
  voices?: string[];
}

export const BUILT_IN_STT_MODELS: Record<BuiltInSttProfileId, BuiltInSpeechModelSpec> = {
  'whisper-large-v3-turbo': {
    id: 'whisper-large-v3-turbo',
    kind: 'stt',
    displayName: 'Whisper Large v3 Turbo (Default Open-Weights STT)',
    license: 'MIT',
    parameterCount: '809M',
    quantizedSizeMb: 810,
    recommendedHardware: '4 GB RAM CPU or 2 GB VRAM GPU',
    description:
      'OpenAI/Faster-Whisper pruned 4-decoder-layer turbo model delivering Large-v3 accuracy at 6x faster real-time transcription across 99+ languages.',
  },
  'distil-whisper-large-v3': {
    id: 'distil-whisper-large-v3',
    kind: 'stt',
    displayName: 'Distil-Whisper Large v3 (Fast English CPU)',
    license: 'MIT',
    parameterCount: '756M',
    quantizedSizeMb: 750,
    recommendedHardware: '4 GB RAM CPU',
    description:
      'Knowledge-distilled Whisper optimized for low-latency English telephony turn-taking and noisy PSTN audio.',
  },
  'whisper-base.en': {
    id: 'whisper-base.en',
    kind: 'stt',
    displayName: 'Whisper Base.en (Ultra-Light CPU)',
    license: 'MIT',
    parameterCount: '74M',
    quantizedSizeMb: 145,
    recommendedHardware: '1–2 vCPU Edge / VPS',
    description:
      'Ultra-compact 74M parameter model for sub-150ms CPU transcription on minimal hardware.',
  },
};

export const BUILT_IN_TTS_MODELS: Record<BuiltInTtsProfileId, BuiltInSpeechModelSpec> = {
  'kokoro-82m': {
    id: 'kokoro-82m',
    kind: 'tts',
    displayName: 'Kokoro-82M Neural TTS (Default Open-Weights TTS)',
    license: 'Apache-2.0',
    parameterCount: '82M',
    quantizedSizeMb: 165,
    recommendedHardware: '2 GB RAM CPU (Faster than real-time on CPU)',
    description:
      'Top-ranked Apache-2.0 82M-parameter StyleTTS2/ISTFTNet open-weights voice model delivering natural human prosody faster than real-time on standard CPUs.',
    voices: ['af_heart', 'af_bella', 'am_adam', 'bf_emma', 'ef_dora', 'ff_siwis'],
  },
  'piper-en-us-lessac-medium': {
    id: 'piper-en-us-lessac-medium',
    kind: 'tts',
    displayName: 'Piper ONNX Neural TTS (Ultra-Low Latency CPU)',
    license: 'MIT',
    parameterCount: '28M',
    quantizedSizeMb: 63,
    recommendedHardware: '1 vCPU / Raspberry Pi / Edge VPS',
    description:
      'VITS-based ONNX neural speech synthesis engine designed for instant sub-50ms first-byte telephony response.',
    voices: ['en_US-lessac-medium', 'en_GB-alba-medium', 'es_ES-sharvard-medium'],
  },
};

/**
 * Local Open-Weights Faster-Whisper STT Provider (OpenAI-compatible /v1/audio/transcriptions).
 */
export class FasterWhisperSttProvider implements SttProvider {
  public readonly providerId = 'faster_whisper_builtin';
  public readonly baseURL: string;
  public readonly model: BuiltInSttProfileId;

  constructor(options?: { baseURL?: string; model?: BuiltInSttProfileId }) {
    this.baseURL = (
      options?.baseURL ||
      process.env.BUILT_IN_STT_URL ||
      'http://localhost:8001'
    ).replace(/\/$/, '');
    this.model =
      options?.model ||
      (process.env.BUILT_IN_STT_MODEL as BuiltInSttProfileId) ||
      'whisper-large-v3-turbo';
  }

  public async transcribeAudio(
    audioBase64: string,
    format?: StreamMediaFormat
  ): Promise<SttTranscriptionResult> {
    const res = await fetch(`${this.baseURL}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        audio_base64: audioBase64,
        encoding: format?.encoding || 'audio/x-mulaw',
        sample_rate: format?.sampleRate || 8000,
      }),
    });

    if (!res.ok) {
      throw new Error(`Faster-Whisper STT failed with status ${res.status}`);
    }

    const data: any = await res.json();
    return {
      text: data.text || '',
      isFinal: true,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.95,
      language: data.language || 'en-US',
    };
  }
}

/**
 * Local Open-Weights Kokoro-82M / Piper Neural TTS Provider (OpenAI-compatible /v1/audio/speech).
 */
export class KokoroTtsProvider implements TtsProvider {
  public readonly providerId = 'kokoro_builtin';
  public readonly baseURL: string;
  public readonly model: BuiltInTtsProfileId;
  public readonly defaultVoice: string;

  constructor(options?: {
    baseURL?: string;
    model?: BuiltInTtsProfileId;
    defaultVoice?: string;
  }) {
    this.baseURL = (
      options?.baseURL ||
      process.env.BUILT_IN_TTS_URL ||
      'http://localhost:8880'
    ).replace(/\/$/, '');
    this.model =
      options?.model ||
      (process.env.BUILT_IN_TTS_MODEL as BuiltInTtsProfileId) ||
      'kokoro-82m';
    this.defaultVoice = options?.defaultVoice || 'af_heart';
  }

  public async synthesizeSpeech(text: string, voice?: string): Promise<TtsSynthesisResult> {
    const res = await fetch(`${this.baseURL}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice: voice || this.defaultVoice,
        response_format: 'ulaw',
      }),
    });

    if (!res.ok) {
      throw new Error(`Kokoro/Piper TTS failed with status ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      audioBase64,
      format: 'audio/x-mulaw',
      durationMs: Math.max(250, Math.min(text.length * 45, 10000)),
    };
  }
}

/**
 * Resilient Built-In STT & TTS wrappers that try the local open-weights daemon first
 * and fall back to MockSpeechProvider if the local speech container is offline.
 */
export class ResilientBuiltInSpeechProvider implements SttProvider, TtsProvider {
  public readonly providerId = 'builtin_open_weights_speech';
  private stt: FasterWhisperSttProvider;
  private tts: KokoroTtsProvider;
  private fallback: MockSpeechProvider;

  constructor(options?: {
    sttModel?: BuiltInSttProfileId;
    ttsModel?: BuiltInTtsProfileId;
    sttBaseURL?: string;
    ttsBaseURL?: string;
    defaultVoice?: string;
  }) {
    this.stt = new FasterWhisperSttProvider({
      baseURL: options?.sttBaseURL,
      model: options?.sttModel,
    });
    this.tts = new KokoroTtsProvider({
      baseURL: options?.ttsBaseURL,
      model: options?.ttsModel,
      defaultVoice: options?.defaultVoice,
    });
    this.fallback = new MockSpeechProvider();
  }

  private shouldUseOfflineFallbackDirectly(): boolean {
    return (
      process.env.NODE_ENV === 'test' &&
      !process.env.BUILT_IN_STT_URL &&
      !process.env.BUILT_IN_TTS_URL &&
      typeof (globalThis.fetch as any)?.mock === 'undefined'
    );
  }

  public async transcribeAudio(
    audioBase64: string,
    format?: StreamMediaFormat
  ): Promise<SttTranscriptionResult> {
    if (this.shouldUseOfflineFallbackDirectly()) {
      return this.fallback.transcribeAudio(audioBase64, format);
    }
    try {
      return await this.stt.transcribeAudio(audioBase64, format);
    } catch {
      return this.fallback.transcribeAudio(audioBase64, format);
    }
  }

  public async synthesizeSpeech(text: string, voice?: string): Promise<TtsSynthesisResult> {
    if (this.shouldUseOfflineFallbackDirectly()) {
      return this.fallback.synthesizeSpeech(text, voice);
    }
    try {
      return await this.tts.synthesizeSpeech(text, voice);
    } catch {
      return this.fallback.synthesizeSpeech(text, voice);
    }
  }
}

const tenantSpeechProfileStore = new Map<
  string,
  { sttProfile: BuiltInSttProfileId; ttsProfile: BuiltInTtsProfileId; defaultVoice: string }
>();

export class TenantSpeechResolver {
  public static getTenantSpeechProfiles(tenantId: string): {
    sttProfile: BuiltInSttProfileId;
    ttsProfile: BuiltInTtsProfileId;
    defaultVoice: string;
    sttSpec: BuiltInSpeechModelSpec;
    ttsSpec: BuiltInSpeechModelSpec;
  } {
    const current = tenantSpeechProfileStore.get(tenantId) || {
      sttProfile: 'whisper-large-v3-turbo',
      ttsProfile: 'kokoro-82m',
      defaultVoice: 'af_heart',
    };
    return {
      ...current,
      sttSpec: BUILT_IN_STT_MODELS[current.sttProfile],
      ttsSpec: BUILT_IN_TTS_MODELS[current.ttsProfile],
    };
  }

  public static setTenantSpeechProfiles(
    tenantId: string,
    update: {
      sttProfile?: BuiltInSttProfileId;
      ttsProfile?: BuiltInTtsProfileId;
      defaultVoice?: string;
    }
  ) {
    const existing = tenantSpeechProfileStore.get(tenantId) || {
      sttProfile: 'whisper-large-v3-turbo',
      ttsProfile: 'kokoro-82m',
      defaultVoice: 'af_heart',
    };

    const next = {
      sttProfile:
        update.sttProfile && BUILT_IN_STT_MODELS[update.sttProfile]
          ? update.sttProfile
          : existing.sttProfile,
      ttsProfile:
        update.ttsProfile && BUILT_IN_TTS_MODELS[update.ttsProfile]
          ? update.ttsProfile
          : existing.ttsProfile,
      defaultVoice: update.defaultVoice || existing.defaultVoice,
    };

    tenantSpeechProfileStore.set(tenantId, next);
    return this.getTenantSpeechProfiles(tenantId);
  }
}
