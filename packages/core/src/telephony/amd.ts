import { TwimlAdapter } from './twiml-adapter.js';

export type AmdClassification =
  | 'human_answered'
  | 'machine_detected_beep'
  | 'machine_detected_no_beep';

export interface AmdSignalInput {
  greetingDurationMs: number;
  silenceAfterGreetingMs?: number;
  wordCount?: number;
  beepDetected?: boolean;
  transcript?: string;
  customerName?: string;
  businessName?: string;
  callbackPhone?: string;
}

export interface AmdDecisionResult {
  classification: AmdClassification;
  confidence: number;
  action: 'start_live_ai_dialog' | 'drop_voicemail_and_sms';
  voicemailDropText: string | null;
  twiml: string;
  triggerSmsFollowUp: boolean;
}

const VOICEMAIL_PHRASES = [
  'leave a message',
  'after the beep',
  'after the tone',
  'not available',
  'unable to take your call',
  'mailbox is full',
  'reached the voicemail',
];

export class AmdDetector {
  /**
   * Classifies whether an outbound call was answered by a live human or an answering machine
   * using acoustic greeting duration, word count, beep detection, and transcript phrases.
   */
  public classifyCallAnswer(input: AmdSignalInput): AmdDecisionResult {
    const businessName = input.businessName || 'Acme Heating & Cooling';
    const customerName = input.customerName || 'valued customer';
    const callbackPhone = input.callbackPhone || '+1-800-555-0199';
    const lowerTranscript = (input.transcript || '').toLowerCase();

    const hasVoicemailPhrase = VOICEMAIL_PHRASES.some((p) => lowerTranscript.includes(p));
    const isLongGreeting = input.greetingDurationMs >= 2600 || (input.wordCount ?? 0) >= 8;

    let classification: AmdClassification = 'human_answered';
    let confidence = 0.92;

    if (input.beepDetected) {
      classification = 'machine_detected_beep';
      confidence = 0.99;
    } else if (hasVoicemailPhrase || isLongGreeting) {
      classification = 'machine_detected_no_beep';
      confidence = hasVoicemailPhrase ? 0.96 : 0.85;
    }

    if (classification === 'human_answered') {
      const liveGreeting = `Hello ${customerName}, this is the automated AI assistant from ${businessName}. How can we help you today?`;
      return {
        classification,
        confidence,
        action: 'start_live_ai_dialog',
        voicemailDropText: null,
        twiml: TwimlAdapter.renderSpeechResponse({
          responseText: liveGreeting,
          actionUrl: '/api/v1/voice/events',
        }),
        triggerSmsFollowUp: false,
      };
    }

    const voicemailDropText = `Hello ${customerName}, this is an automated reminder from ${businessName} regarding your upcoming service appointment. Please call us back at ${callbackPhone} or reply to our text message if you need to reschedule. Thank you!`;

    return {
      classification,
      confidence,
      action: 'drop_voicemail_and_sms',
      voicemailDropText,
      twiml: TwimlAdapter.renderHangup({ message: voicemailDropText }),
      triggerSmsFollowUp: true,
    };
  }
}
