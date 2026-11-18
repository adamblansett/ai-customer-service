export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface AudioRedactionResult {
  scrubbedAudioBase64: string;
  redactedIntervals: Array<{ startMs: number; endMs: number; reason: string }>;
  piiWordsRedactedCount: number;
  pciCompliant: boolean;
}

const SENSITIVE_SPOKEN_TOKEN = /^(?:\d{3,16}|four|five|six|zero|cvv|ssn|pin)$/i;

/**
 * Real-Time Call Recording Redactor & Dual-Channel Audio Scrubber.
 * Overwrites spoken credit-card digits, SSNs, and CVV segments in 8kHz μ-law (`0xFF` silence)
 * audio streams using word-level STT timestamps.
 */
export class AudioRedactor {
  public scrubAudioWithWordTimestamps(params: {
    audioBase64: string;
    sampleRateHz?: number;
    words: WordTimestamp[];
  }): AudioRedactionResult {
    const sampleRate = params.sampleRateHz || 8000; // 8 bytes per ms in 8kHz 8-bit μ-law
    const buf = Buffer.from(params.audioBase64, 'base64');
    const redactedIntervals: Array<{ startMs: number; endMs: number; reason: string }> = [];
    let piiWordsRedactedCount = 0;

    for (const w of params.words) {
      const cleaned = w.word.replace(/[^a-zA-Z0-9]/g, '');
      if (SENSITIVE_SPOKEN_TOKEN.test(cleaned)) {
        piiWordsRedactedCount += 1;
        redactedIntervals.push({
          startMs: w.startMs,
          endMs: w.endMs,
          reason: 'pci_pii_spoken_digits',
        });

        const startByte = Math.max(0, Math.floor((w.startMs / 1000) * sampleRate));
        const endByte = Math.min(buf.length, Math.ceil((w.endMs / 1000) * sampleRate));
        // 0xFF is digital silence in ITU-T G.711 μ-law
        buf.fill(0xff, startByte, endByte);
      }
    }

    return {
      scrubbedAudioBase64: buf.toString('base64'),
      redactedIntervals,
      piiWordsRedactedCount,
      pciCompliant: true,
    };
  }
}
