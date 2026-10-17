export interface TelnyxCallEvent {
  callControlId: string;
  callLegId: string;
  eventType: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  payload: Record<string, any>;
}

export class TelnyxAdapter {
  /**
   * Parses incoming Telnyx Call Control v2 webhook payload.
   */
  public static parseWebhook(body: any): TelnyxCallEvent {
    const data = body?.data || body;
    const payload = data?.payload || {};

    return {
      callControlId: payload.call_control_id || data.call_control_id || '',
      callLegId: payload.call_leg_id || '',
      eventType: data.event_type || 'call.initiated',
      from: payload.from || '',
      to: payload.to || '',
      direction: payload.direction === 'incoming' ? 'inbound' : 'outbound',
      payload,
    };
  }

  /**
   * Formats a Telnyx Call Control /actions/speak command payload.
   */
  public static buildSpeakCommand(params: {
    payloadText: string;
    voice?: string;
    language?: string;
  }): Record<string, any> {
    return {
      payload: params.payloadText,
      voice: params.voice || 'female',
      language: params.language || 'en-US',
      payload_type: 'text',
    };
  }

  /**
   * Formats a Telnyx Call Control /actions/transfer command payload.
   */
  public static buildTransferCommand(to: string): Record<string, any> {
    return {
      to,
      time_limit_secs: 60,
      timeout_secs: 30,
    };
  }

  /**
   * Formats a Telnyx Call Control /actions/gather_using_speak command.
   */
  public static buildGatherUsingSpeakCommand(params: {
    payloadText: string;
    voice?: string;
    language?: string;
  }): Record<string, any> {
    return {
      payload: params.payloadText,
      voice: params.voice || 'female',
      language: params.language || 'en-US',
      payload_type: 'text',
      maximum_digits: 1,
      timeout_millis: 5000,
    };
  }
}
