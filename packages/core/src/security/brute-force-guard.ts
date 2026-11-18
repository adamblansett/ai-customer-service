interface FailedAttemptBucket {
  failures: number;
  lockedUntilMs: number;
}

/**
 * Progressive Account & IP Brute-Force Lockout Guard + JWT JTI Revocation Blacklist
 * + Production Fail-Closed Secret Validator.
 */
export class LoginBruteForceGuard {
  private buckets = new Map<string, FailedAttemptBucket>();
  private readonly maxFailures: number;
  private readonly lockoutDurationMs: number;

  constructor(options?: { maxFailures?: number; lockoutDurationMs?: number }) {
    this.maxFailures = options?.maxFailures ?? 5;
    this.lockoutDurationMs = options?.lockoutDurationMs ?? 15 * 60_000; // 15 minutes
  }

  public checkAllowed(identifier: string): {
    allowed: boolean;
    remainingAttempts: number;
    retryAfterSeconds: number;
  } {
    const key = identifier.toLowerCase().trim();
    const bucket = this.buckets.get(key);
    const now = Date.now();

    if (!bucket) {
      return { allowed: true, remainingAttempts: this.maxFailures, retryAfterSeconds: 0 };
    }

    if (bucket.lockedUntilMs > now) {
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: Math.ceil((bucket.lockedUntilMs - now) / 1000),
      };
    }

    if (bucket.lockedUntilMs > 0 && bucket.lockedUntilMs <= now) {
      this.buckets.delete(key);
      return { allowed: true, remainingAttempts: this.maxFailures, retryAfterSeconds: 0 };
    }

    return {
      allowed: true,
      remainingAttempts: Math.max(0, this.maxFailures - bucket.failures),
      retryAfterSeconds: 0,
    };
  }

  public recordFailure(identifier: string): { locked: boolean; failures: number } {
    const key = identifier.toLowerCase().trim();
    const bucket = this.buckets.get(key) || { failures: 0, lockedUntilMs: 0 };
    bucket.failures += 1;

    if (bucket.failures >= this.maxFailures) {
      bucket.lockedUntilMs = Date.now() + this.lockoutDurationMs;
    }

    this.buckets.set(key, bucket);
    return { locked: bucket.lockedUntilMs > Date.now(), failures: bucket.failures };
  }

  public reset(identifier: string): void {
    this.buckets.delete(identifier.toLowerCase().trim());
  }
}

export class TokenRevocationList {
  private static revokedJtis = new Map<string, number>(); // jti -> expMs

  public static revoke(jti: string, expiresAtMs = Date.now() + 7 * 86_400_000): void {
    if (!jti) return;
    this.revokedJtis.set(jti, expiresAtMs);
  }

  public static isRevoked(jti?: string): boolean {
    if (!jti) return false;
    const exp = this.revokedJtis.get(jti);
    if (!exp) return false;
    if (exp < Date.now()) {
      this.revokedJtis.delete(jti);
      return false;
    }
    return true;
  }
}

const INSECURE_PLACEHOLDER_SECRETS = new Set([
  'dev-insecure-jwt-secret-replace-in-production-12345',
  'default-change-me-jwt-secret-for-production!',
  'default-change-me-master-key-32bytes-long!',
  'dev-default-master-encryption-key-32b!',
]);

/**
 * Fails closed at startup in NODE_ENV=production if cryptographic secrets are missing or use known defaults.
 */
export function assertProductionSecretsConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const jwtSecret = env.JWT_SECRET || '';
  const masterKey = env.ENCRYPTION_MASTER_KEY || '';

  if (jwtSecret.length < 32 || INSECURE_PLACEHOLDER_SECRETS.has(jwtSecret)) {
    throw new Error(
      'FatalSecurityConfigError: Refusing to start in production with missing, short (<32 chars), or placeholder JWT_SECRET.'
    );
  }

  if (masterKey.length < 32 || INSECURE_PLACEHOLDER_SECRETS.has(masterKey)) {
    throw new Error(
      'FatalSecurityConfigError: Refusing to start in production with missing, short (<32 chars), or placeholder ENCRYPTION_MASTER_KEY.'
    );
  }
}
