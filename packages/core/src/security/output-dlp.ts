import { redactSensitiveData } from './redaction.js';

const AWS_KEY_REGEX = /\bAKIA[0-9A-Z]{16}\b/g;
const ANTHROPIC_KEY_REGEX = /\bsk-ant-[a-zA-Z0-9_-]{16,}\b/g;
const INTERNAL_TAG_REGEX = /<\/?(?:retrieved_context|system_instructions|internal_policy)[^>]*>/gi;

/**
 * Outbound AI Data Loss Prevention (DLP) & Secret Exfiltration Guard.
 * Ensures model completions never echo runtime environment secrets, cloud API keys,
 * unmasked credit cards, SSNs, or internal prompt XML delimiters to callers or web visitors.
 */
export class OutputDlpGuard {
  public static sanitizeAiOutput(
    rawOutput: string,
    env: NodeJS.ProcessEnv = process.env
  ): { sanitizedText: string; dlpTriggered: boolean } {
    if (!rawOutput) {
      return { sanitizedText: '', dlpTriggered: false };
    }

    let text = redactSensitiveData(rawOutput)
      .replace(AWS_KEY_REGEX, '[REDACTED_AWS_KEY]')
      .replace(ANTHROPIC_KEY_REGEX, '[REDACTED_API_KEY]')
      .replace(INTERNAL_TAG_REGEX, '');

    // Scrub exact runtime secrets if >= 12 chars so they can never be exfiltrated via prompt injection
    const runtimeSecrets = [env.ENCRYPTION_MASTER_KEY, env.JWT_SECRET, env.DATABASE_URL].filter(
      (s): s is string => Boolean(s && s.length >= 12)
    );

    for (const secret of runtimeSecrets) {
      if (text.includes(secret)) {
        text = text.split(secret).join('[REDACTED_RUNTIME_SECRET]');
      }
    }

    const dlpTriggered = text !== rawOutput;
    return {
      sanitizedText: text.trim(),
      dlpTriggered,
    };
  }
}
