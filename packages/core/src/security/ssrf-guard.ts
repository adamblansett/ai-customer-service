export class SsrfViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfViolationError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal',
  'metadata',
  'postgres',
  'builtin-ai',
  'redis',
  'customer_service_postgres',
  'customer_service_builtin_ai',
  'customer_service_api',
]);

/**
 * Server-Side Request Forgery (SSRF) Guard.
 * Blocks loopback, RFC1918 private networks, AWS/GCP/Azure link-local metadata IPs (169.254.169.254),
 * internal Docker Compose service hostnames, and non-HTTP(S) schemes.
 */
export class SsrfGuard {
  public static assertSafeExternalUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new SsrfViolationError(`SSRFBlocked: Invalid URL '${rawUrl}'.`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SsrfViolationError(
        `SSRFBlocked: Disallowed URL scheme '${parsed.protocol}'. Only http: and https: are permitted.`
      );
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.internal') || host.endsWith('.local')) {
      throw new SsrfViolationError(
        `SSRFBlocked: Access to internal or loopback host '${host}' is forbidden.`
      );
    }

    // Check IPv4 private, loopback, and cloud metadata ranges
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [a, b] = ipv4Match.slice(1).map(Number);
      const isLoopback = a === 127 || a === 0;
      const isPrivate10 = a === 10;
      const isPrivate172 = a === 172 && b >= 16 && b <= 31;
      const isPrivate192 = a === 192 && b === 168;
      const isLinkLocalMetadata = a === 169 && b === 254;
      const isAlibabaMetadata = a === 100 && b >= 64 && b <= 127;

      if (
        isLoopback ||
        isPrivate10 ||
        isPrivate172 ||
        isPrivate192 ||
        isLinkLocalMetadata ||
        isAlibabaMetadata
      ) {
        throw new SsrfViolationError(
          `SSRFBlocked: Access to private, loopback, or cloud metadata IP '${host}' is forbidden.`
        );
      }
    }

    // Check IPv6 loopback / unique-local / link-local
    if (host.includes(':')) {
      if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
        throw new SsrfViolationError(
          `SSRFBlocked: Access to private or loopback IPv6 address '${host}' is forbidden.`
        );
      }
    }

    return parsed;
  }
}
