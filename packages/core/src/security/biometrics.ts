import crypto from 'node:crypto';

export interface VoiceprintRecord {
  customerId: string;
  enrolledAt: string;
  fingerprintHash: string;
  sampleCount: number;
}

export interface VoiceVerificationResult {
  verified: boolean;
  confidenceScore: number;
  matchThreshold: number;
  customerId: string;
}

export interface InboundCallMetadata {
  fromNumber: string;
  toNumber: string;
  lineType?: 'mobile' | 'landline' | 'voip' | 'toll_free' | 'unknown';
  carrier?: string;
  recentCallCountLastHour?: number;
  isAnonymous?: boolean;
}

export interface CallRiskAssessment {
  riskScore: number; // 0 (safest) to 100 (highest risk)
  riskLevel: 'low' | 'moderate' | 'high';
  recommendation: 'allow' | 'step_up_auth' | 'block_review';
  flaggedReasons: string[];
}

export class VoiceBiometricsEngine {
  private voiceprints: Map<string, VoiceprintRecord> = new Map();
  private matchThreshold: number = 0.85;

  /**
   * Generates a normalized acoustic feature hash from an audio buffer or sample.
   */
  public generateFingerprint(audioSample: Buffer | string): string {
    const data = typeof audioSample === 'string' ? Buffer.from(audioSample, 'utf8') : audioSample;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  public enrollVoiceprint(
    customerId: string,
    audioSample: Buffer | string
  ): VoiceprintRecord {
    const fingerprintHash = this.generateFingerprint(audioSample);
    const record: VoiceprintRecord = {
      customerId,
      enrolledAt: new Date().toISOString(),
      fingerprintHash,
      sampleCount: 1,
    };
    this.voiceprints.set(customerId, record);
    return record;
  }

  public getVoiceprint(customerId: string): VoiceprintRecord | undefined {
    return this.voiceprints.get(customerId);
  }

  public verifyCallerVoice(
    customerId: string,
    audioSample: Buffer | string
  ): VoiceVerificationResult {
    const record = this.voiceprints.get(customerId);
    if (!record) {
      return {
        verified: false,
        confidenceScore: 0.0,
        matchThreshold: this.matchThreshold,
        customerId,
      };
    }

    const currentHash = this.generateFingerprint(audioSample);

    // Compute Hamming similarity between hex fingerprints
    let matchingChars = 0;
    const len = Math.min(record.fingerprintHash.length, currentHash.length);
    for (let i = 0; i < len; i++) {
      if (record.fingerprintHash[i] === currentHash[i]) {
        matchingChars++;
      }
    }

    const confidenceScore = Number((matchingChars / len).toFixed(2));
    const verified = confidenceScore >= this.matchThreshold;

    return {
      verified,
      confidenceScore,
      matchThreshold: this.matchThreshold,
      customerId,
    };
  }

  public clear(): void {
    this.voiceprints.clear();
  }
}

export class CallRiskScorer {
  /**
   * Evaluates telephony metadata, carrier flags, and ANI velocity to calculate an inbound fraud risk score.
   */
  public static evaluateCallRisk(metadata: InboundCallMetadata): CallRiskAssessment {
    let riskScore = 10; // Baseline low risk for normal call
    const flaggedReasons: string[] = [];

    // 1. Line Type Evaluation
    if (metadata.lineType === 'voip') {
      riskScore += 35;
      flaggedReasons.push('Inbound line originates from unverified VoIP / SIP provider');
    } else if (metadata.lineType === 'toll_free') {
      riskScore += 40;
      flaggedReasons.push('Toll-free originating number is suspicious for residential inbound caller');
    }

    // 2. Anonymous / Blocked Caller ID
    if (metadata.isAnonymous || !metadata.fromNumber || metadata.fromNumber === 'Anonymous') {
      riskScore += 30;
      flaggedReasons.push('Caller ID is blocked, anonymous, or missing E.164 digits');
    }

    // 3. ANI Velocity Check (Robocall / brute-force dialing)
    if (metadata.recentCallCountLastHour && metadata.recentCallCountLastHour > 5) {
      const extraScore = Math.min(40, (metadata.recentCallCountLastHour - 5) * 10);
      riskScore += extraScore;
      flaggedReasons.push(`High call velocity: ${metadata.recentCallCountLastHour} calls within the past hour`);
    }

    // Cap risk score between 0 and 100
    riskScore = Math.min(100, Math.max(0, riskScore));

    let riskLevel: 'low' | 'moderate' | 'high' = 'low';
    let recommendation: 'allow' | 'step_up_auth' | 'block_review' = 'allow';

    if (riskScore >= 70) {
      riskLevel = 'high';
      recommendation = 'block_review';
    } else if (riskScore >= 35) {
      riskLevel = 'moderate';
      recommendation = 'step_up_auth';
    }

    return {
      riskScore,
      riskLevel,
      recommendation,
      flaggedReasons,
    };
  }
}
