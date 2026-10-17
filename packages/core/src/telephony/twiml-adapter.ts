function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class TwimlAdapter {
  /**
   * Renders the initial inbound greeting TwiML:
   * Optional recording consent -> AI greeting -> Speech gather.
   */
  static renderGreeting(params: {
    greeting: string;
    actionUrl: string;
    recordingConsent?: string | null;
    voice?: string;
  }): string {
    const voice = params.voice || 'Polly.Joanna-Neural';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';

    if (params.recordingConsent) {
      xml += `  <Say voice="${voice}">${escapeXml(params.recordingConsent)}</Say>\n`;
    }

    xml += `  <Gather input="speech" action="${escapeXml(params.actionUrl)}" method="POST" speechTimeout="auto" timeout="4">\n`;
    xml += `    <Say voice="${voice}">${escapeXml(params.greeting)}</Say>\n`;
    xml += '  </Gather>\n';
    xml += `  <Say voice="${voice}">I didn't hear a response. Please hold or say your request.</Say>\n`;
    xml += `  <Redirect>${escapeXml(params.actionUrl)}</Redirect>\n`;
    xml += '</Response>';

    return xml;
  }

  /**
   * Renders a conversational speech response with follow-up gather.
   */
  static renderSpeechResponse(params: {
    responseText: string;
    actionUrl: string;
    voice?: string;
  }): string {
    const voice = params.voice || 'Polly.Joanna-Neural';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';
    xml += `  <Gather input="speech" action="${escapeXml(params.actionUrl)}" method="POST" speechTimeout="auto" timeout="4">\n`;
    xml += `    <Say voice="${voice}">${escapeXml(params.responseText)}</Say>\n`;
    xml += '  </Gather>\n';
    xml += `  <Say voice="${voice}">I didn't hear a response. Are you still there?</Say>\n`;
    xml += `  <Redirect>${escapeXml(params.actionUrl)}</Redirect>\n`;
    xml += '</Response>';

    return xml;
  }

  /**
   * Renders a transfer to a human representative telephone number.
   */
  static renderTransfer(params: {
    destinationNumber: string;
    actionUrl: string; // Called when transfer completes, fails, or times out
    announcement?: string;
    timeoutSeconds?: number;
    voice?: string;
  }): string {
    const voice = params.voice || 'Polly.Joanna-Neural';
    const timeout = params.timeoutSeconds ?? 30;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';
    if (params.announcement) {
      xml += `  <Say voice="${voice}">${escapeXml(params.announcement)}</Say>\n`;
    }
    xml += `  <Dial timeout="${timeout}" action="${escapeXml(params.actionUrl)}" method="POST">\n`;
    xml += `    <Number>${escapeXml(params.destinationNumber)}</Number>\n`;
    xml += '  </Dial>\n';
    xml += '</Response>';

    return xml;
  }

  /**
   * Renders a final confirmation message and clean hangup.
   */
  static renderHangup(params: { message: string; voice?: string }): string {
    const voice = params.voice || 'Polly.Joanna-Neural';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';
    xml += `  <Say voice="${voice}">${escapeXml(params.message)}</Say>\n`;
    xml += '  <Hangup/>\n';
    xml += '</Response>';

    return xml;
  }

  /**
   * Renders a bidirectional WebSocket Media Stream instruction.
   */
  static renderMediaStream(params: {
    streamUrl: string;
    customParameters?: Record<string, string>;
  }): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';
    xml += '  <Connect>\n';
    xml += `    <Stream url="${escapeXml(params.streamUrl)}">\n`;
    if (params.customParameters) {
      for (const [key, val] of Object.entries(params.customParameters)) {
        xml += `      <Parameter name="${escapeXml(key)}" value="${escapeXml(val)}"/>\n`;
      }
    }
    xml += '    </Stream>\n';
    xml += '  </Connect>\n';
    xml += '</Response>';

    return xml;
  }
}

