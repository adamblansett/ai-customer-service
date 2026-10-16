/**
 * Redaction utility for logs and customer messages to ensure sensitive data
 * (passwords, auth tokens, credit cards, SSNs) never leak into operational logs.
 */

const CREDIT_CARD_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
const SSN_REGEX = /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/g;
const BEARER_AUTH_REGEX = /Bearer\s+([a-zA-Z0-9_\-\.]+)/gi;
const API_KEY_REGEX = /(?:sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35})/g;
const PASSWORD_FIELD_REGEX = /"(?:password|apiKey|token|secret|authTag)":\s*"[^"]*"/gi;

export function redactSensitiveData(input: string): string {
  if (!input) return input;

  return input
    .replace(CREDIT_CARD_REGEX, '[REDACTED_CREDIT_CARD]')
    .replace(SSN_REGEX, '[REDACTED_SSN]')
    .replace(BEARER_AUTH_REGEX, 'Bearer [REDACTED_TOKEN]')
    .replace(API_KEY_REGEX, '[REDACTED_API_KEY]')
    .replace(PASSWORD_FIELD_REGEX, '"[FIELD]":"[REDACTED]"');
}

/**
 * Redacts object properties deeply for logging.
 */
export function sanitizeLogObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return redactSensitiveData(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeLogObject(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('credential') ||
        lowerKey.includes('authtag') ||
        lowerKey.includes('encrypteddata')
      ) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeLogObject(value);
      }
    }
    return sanitized as T;
  }
  return obj;
}
