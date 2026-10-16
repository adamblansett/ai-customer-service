export type CallLifecycleStatus =
  | 'ringing'
  | 'in-progress'
  | 'transferring'
  | 'transferred'
  | 'completed'
  | 'failed'
  | 'no-answer'
  | 'busy';

export interface InboundCallPayload {
  callSid: string;
  provider: 'twilio' | 'sip' | 'simulator';
  from: string;
  to: string;
  direction?: 'inbound' | 'outbound';
  callStatus?: string;
  speechResult?: string;
  digits?: string;
  confidence?: number;
}

export interface TelephonyActionOutput {
  twiml?: string;
  action: 'gather' | 'dial' | 'hangup' | 'say';
  message?: string;
  transferDestination?: string;
  timeoutSeconds?: number;
  shouldHangup?: boolean;
}
