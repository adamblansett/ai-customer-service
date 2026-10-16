import { InboundCallPayload } from './types.js';

export interface SipWebhookEvent {
  sipCallId: string;
  eventType: 'INVITE' | 'ANSWER' | 'SPEECH' | 'REFER' | 'BYE';
  callerUri: string;
  calleeUri: string;
  speechText?: string;
  duration?: number;
}

export class SipAdapter {
  /**
   * Normalizes incoming SIP PBX webhook events into standard InboundCallPayload.
   */
  static normalizeSipEvent(event: SipWebhookEvent): InboundCallPayload {
    // Extract phone numbers from SIP URIs: sip:+15550101@sip.example.com -> +15550101
    const fromMatch = event.callerUri.match(/sip:([^@]+)/);
    const toMatch = event.calleeUri.match(/sip:([^@]+)/);

    const from = fromMatch ? fromMatch[1] : event.callerUri;
    const to = toMatch ? toMatch[1] : event.calleeUri;

    let callStatus = 'in-progress';
    if (event.eventType === 'INVITE') callStatus = 'ringing';
    else if (event.eventType === 'BYE') callStatus = 'completed';

    return {
      callSid: `sip_${event.sipCallId}`,
      provider: 'sip',
      from,
      to,
      direction: 'inbound',
      callStatus,
      speechResult: event.speechText,
    };
  }

  /**
   * Formats a SIP action response (e.g. for FreeSWITCH XML dialplan or Asterisk ARI command).
   */
  static formatSipAction(action: 'play_and_detect' | 'transfer' | 'hangup', params: Record<string, any>) {
    return {
      protocol: 'SIP',
      action,
      params,
    };
  }
}
