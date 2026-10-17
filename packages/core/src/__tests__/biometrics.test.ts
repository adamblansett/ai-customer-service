import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceBiometricsEngine, CallRiskScorer } from '../security/biometrics.js';

describe('Voice Biometrics & Call Risk Scoring Suite', () => {
  let biometrics: VoiceBiometricsEngine;

  beforeEach(() => {
    biometrics = new VoiceBiometricsEngine();
  });

  describe('VoiceBiometricsEngine', () => {
    const customerId = 'cust_bio_001';
    const sampleAudioA = 'acoustic_waveform_sample_voice_vance_passphrase_acme_hvac_2026';
    const sampleAudioB = 'acoustic_waveform_sample_voice_fraudster_impostor_2026_xyz';

    it('enrolls customer voiceprint and verifies authentic caller voice', () => {
      const enrollment = biometrics.enrollVoiceprint(customerId, sampleAudioA);
      expect(enrollment.customerId).toBe(customerId);
      expect(enrollment.fingerprintHash).toBeDefined();

      // Authentic caller submits same passphrase waveform
      const result = biometrics.verifyCallerVoice(customerId, sampleAudioA);
      expect(result.verified).toBe(true);
      expect(result.confidenceScore).toBe(1.0);
    });

    it('rejects unverified voice or non-enrolled caller', () => {
      biometrics.enrollVoiceprint(customerId, sampleAudioA);

      // Impostor submits different acoustic waveform
      const impostorResult = biometrics.verifyCallerVoice(customerId, sampleAudioB);
      expect(impostorResult.verified).toBe(false);

      // Unknown caller
      const unknownResult = biometrics.verifyCallerVoice('non_existent_customer', sampleAudioA);
      expect(unknownResult.verified).toBe(false);
      expect(unknownResult.confidenceScore).toBe(0.0);
    });
  });

  describe('CallRiskScorer', () => {
    it('rates legitimate mobile inbound call as low risk', () => {
      const assessment = CallRiskScorer.evaluateCallRisk({
        fromNumber: '+15553492041',
        toNumber: '+18005550199',
        lineType: 'mobile',
        recentCallCountLastHour: 1,
      });

      expect(assessment.riskLevel).toBe('low');
      expect(assessment.recommendation).toBe('allow');
      expect(assessment.riskScore).toBeLessThan(35);
      expect(assessment.flaggedReasons).toHaveLength(0);
    });

    it('flags unverified VoIP lines for step-up authentication', () => {
      const assessment = CallRiskScorer.evaluateCallRisk({
        fromNumber: '+15559871122',
        toNumber: '+18005550199',
        lineType: 'voip',
        recentCallCountLastHour: 2,
      });

      expect(assessment.riskLevel).toBe('moderate');
      expect(assessment.recommendation).toBe('step_up_auth');
      expect(assessment.flaggedReasons.some((r) => r.includes('VoIP'))).toBe(true);
    });

    it('escalates anonymous caller with rapid velocity to block/review', () => {
      const assessment = CallRiskScorer.evaluateCallRisk({
        fromNumber: 'Anonymous',
        toNumber: '+18005550199',
        isAnonymous: true,
        lineType: 'voip',
        recentCallCountLastHour: 12,
      });

      expect(assessment.riskLevel).toBe('high');
      expect(assessment.recommendation).toBe('block_review');
      expect(assessment.riskScore).toBeGreaterThanOrEqual(70);
      expect(assessment.flaggedReasons.some((r) => r.includes('velocity'))).toBe(true);
    });
  });
});
