const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|directions)/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts)/i,
  /(you\s+are\s+now|act\s+as)\s+(an\s+unfiltered|in\s+developer\s+mode|dan\s+mode|jailbroken)/i,
  /reveal\s+(your\s+)?(system\s+prompt|initial\s+instructions|secret\s+key)/i,
  /system\s+prompt\s*:/i,
  /\[SYSTEM_OVERRIDE\]/i,
  /<system>/i,
  /sudo\s+mode/i,
];

export interface InjectionCheckResult {
  isSuspicious: boolean;
  detectedPatterns: string[];
}

/**
 * Scans input text for known prompt injection and jailbreak patterns.
 */
export function detectPromptInjection(input: string): InjectionCheckResult {
  if (!input) return { isSuspicious: false, detectedPatterns: [] };

  const matches: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      matches.push(pattern.source);
    }
  }

  return {
    isSuspicious: matches.length > 0,
    detectedPatterns: matches,
  };
}

/**
 * Wraps untrusted user content or retrieved documents in strict XML delimiters
 * with explicit instructions to prevent prompt escape.
 */
export function wrapUntrustedContext(tagName: string, content: string): string {
  // Sanitize any closing tag attempts within the content
  const sanitized = content.replace(new RegExp(`</${tagName}>`, 'gi'), `[ESCAPED_${tagName.toUpperCase()}]`);
  return `<${tagName}>\n${sanitized}\n</${tagName}>`;
}
