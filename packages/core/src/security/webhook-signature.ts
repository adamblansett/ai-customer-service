import crypto from 'node:crypto';

/**
 * Cryptographic Carrier Webhook Signature Verifier
 * Supports:
 *  - Twilio (X-Twilio-Signature, HMAC-SHA1 base64 over URL + sorted POST params)
 *  - Plivo / Telnyx (HMAC-SHA256 base64)
 *  - Meta WhatsApp Business Cloud API (X-Hub-Signature-256, sha256=<hex>)
 */
export class WebhookSignatureVerifier {
  /**
   * Computes canonical Twilio webhook signature (HMAC-SHA1 base64).
   */
  public static computeTwilioSignature(
    authToken: string,
    fullUrl: string,
    params: Record<string, any> = {}
  ): string {
    const sortedKeys = Object.keys(params).sort();
    let data = fullUrl;
    for (const key of sortedKeys) {
      const val = params[key];
      data += key + (val !== undefined && val !== null ? String(val) : '');
    }
    return crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
  }

  /**
   * Verifies X-Twilio-Signature in constant time.
   */
  public static verifyTwilioSignature(
    authToken: string,
    fullUrl: string,
    params: Record<string, any>,
    providedSignature?: string
  ): boolean {
    if (!authToken || !providedSignature) return false;
    const expected = this.computeTwilioSignature(authToken, fullUrl, params);
    const bufExpected = Buffer.from(expected, 'utf8');
    const bufProvided = Buffer.from(providedSignature, 'utf8');
    if (bufExpected.length !== bufProvided.length) return false;
    return crypto.timingSafeEqual(bufExpected, bufProvided);
  }

  /**
   * Computes HMAC-SHA256 base64 signature (used by Plivo v2 / Telnyx HMAC webhooks).
   */
  public static computeHmacSha256Base64(secret: string, payload: string): string {
    return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64');
  }

  public static verifyHmacSha256Base64(
    secret: string,
    payload: string,
    providedSignature?: string
  ): boolean {
    if (!secret || !providedSignature) return false;
    const expected = this.computeHmacSha256Base64(secret, payload);
    const bufExpected = Buffer.from(expected, 'utf8');
    const bufProvided = Buffer.from(providedSignature, 'utf8');
    if (bufExpected.length !== bufProvided.length) return false;
    return crypto.timingSafeEqual(bufExpected, bufProvided);
  }

  /**
   * Computes Meta WhatsApp X-Hub-Signature-256 header (`sha256=<hex>`).
   */
  public static computeWhatsAppSignature(appSecret: string, rawBody: string): string {
    const hex = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
    return `sha256=${hex}`;
  }

  public static verifyWhatsAppSignature(
    appSecret: string,
    rawBody: string,
    providedHeader?: string
  ): boolean {
    if (!appSecret || !providedHeader) return false;
    const expected = this.computeWhatsAppSignature(appSecret, rawBody);
    const bufExpected = Buffer.from(expected, 'utf8');
    const bufProvided = Buffer.from(providedHeader, 'utf8');
    if (bufExpected.length !== bufProvided.length) return false;
    return crypto.timingSafeEqual(bufExpected, bufProvided);
  }
}
