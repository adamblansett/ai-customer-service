function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface PlivoCallEvent {
  callUuid: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  callStatus: string;
  digits?: string;
  speech?: string;
}

export class PlivoAdapter {
  /**
   * Parses Plivo inbound call webhook parameters.
   */
  public static parseWebhook(body: Record<string, any>): PlivoCallEvent {
    return {
      callUuid: body.CallUUID || body.call_uuid || '',
      from: body.From || body.from || '',
      to: body.To || body.to || '',
      direction: body.Direction === 'inbound' ? 'inbound' : 'outbound',
      callStatus: body.CallStatus || 'ringing',
      digits: body.Digits,
      speech: body.Speech,
    };
  }

  /**
   * Renders Plivo XML response with speech.
   */
  public static renderSpeakResponse(params: {
    message: string;
    voice?: string;
    actionUrl?: string;
  }): string {
    const voice = params.voice || 'WOMAN';
    let xml = '<Response>\n';
    if (params.actionUrl) {
      xml += `  <GetDigits action="${escapeXml(params.actionUrl)}" method="POST" timeout="5" numDigits="1">\n`;
      xml += `    <Speak voice="${voice}">${escapeXml(params.message)}</Speak>\n`;
      xml += '  </GetDigits>\n';
    } else {
      xml += `  <Speak voice="${voice}">${escapeXml(params.message)}</Speak>\n`;
    }
    xml += '</Response>';
    return xml;
  }

  /**
   * Renders Plivo XML transfer to representative.
   */
  public static renderDialTransfer(params: {
    toNumber: string;
    callerId?: string;
    actionUrl?: string;
  }): string {
    let xml = '<Response>\n';
    xml += '  <Speak voice="WOMAN">Please hold while we transfer your call.</Speak>\n';
    const callerIdAttr = params.callerId ? ` callerId="${escapeXml(params.callerId)}"` : '';
    const actionAttr = params.actionUrl ? ` action="${escapeXml(params.actionUrl)}"` : '';
    xml += `  <Dial${callerIdAttr}${actionAttr}>\n`;
    xml += `    <Number>${escapeXml(params.toNumber)}</Number>\n`;
    xml += '  </Dial>\n';
    xml += '</Response>';
    return xml;
  }

  /**
   * Renders Plivo hangup with optional final announcement.
   */
  public static renderHangup(message?: string): string {
    let xml = '<Response>\n';
    if (message) {
      xml += `  <Speak voice="WOMAN">${escapeXml(message)}</Speak>\n`;
    }
    xml += '  <Hangup/>\n';
    xml += '</Response>';
    return xml;
  }
}
