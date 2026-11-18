import { describe, it, expect, beforeAll } from 'vitest';
import { getDatabase, seedDatabase, type DatabaseInstance } from '@customer-service/db';
import {
  SsrfGuard,
  SsrfViolationError,
  TotpMfaManager,
  ApiKeyManager,
  AuditChainManager,
  LoginBruteForceGuard,
  TokenRevocationList,
  assertProductionSecretsConfigured,
} from '../index.js';

describe('Enterprise Security Hardening Suite (SSRF, TOTP MFA, API Keys, Audit Chain, Brute-Force & Secret Guards)', () => {
  let db: DatabaseInstance;
  let tenant1Id: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seeded = await seedDatabase(db);
    tenant1Id = seeded.tenant1Id;
  });

  it('blocks SSRF attacks targeting AWS/GCP metadata, loopback, RFC1918 private IPs, file://, and internal Docker hosts', () => {
    const maliciousUrls = [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://127.0.0.1:5432/postgres',
      'http://localhost:11434/api/tags',
      'http://10.0.0.12:8080/internal',
      'http://172.16.5.4/admin',
      'http://192.168.1.1/router',
      'http://[::1]:3001/health',
      'http://postgres:5432/',
      'file:///etc/passwd',
    ];

    for (const badUrl of maliciousUrls) {
      expect(() => SsrfGuard.assertSafeExternalUrl(badUrl)).toThrow(SsrfViolationError);
    }

    const safeUrl = SsrfGuard.assertSafeExternalUrl('https://docs.acme-hvac.example.com/pricing');
    expect(safeUrl.hostname).toBe('docs.acme-hvac.example.com');
  });

  it('enrolls and verifies RFC 6238 TOTP 2FA codes in constant time', () => {
    const enrollment = TotpMfaManager.generateEnrollment('admin@acme-hvac.example.com');
    expect(enrollment.otpauthUri).toContain('otpauth://totp/');
    expect(enrollment.backupCodes).toHaveLength(6);

    const fixedNow = 1_700_000_000_000;
    const validCode = TotpMfaManager.generateTotpCode(enrollment.secretBase32, fixedNow);
    expect(validCode).toMatch(/^\d{6}$/);

    expect(
      TotpMfaManager.verifyTotpCode(enrollment.secretBase32, validCode, fixedNow)
    ).toBe(true);
    // ±30s clock-drift window should also pass
    expect(
      TotpMfaManager.verifyTotpCode(enrollment.secretBase32, validCode, fixedNow + 25_000)
    ).toBe(true);
    expect(
      TotpMfaManager.verifyTotpCode(enrollment.secretBase32, '000000', fixedNow)
    ).toBe(false);
  });

  it('issues SHA-256 hashed scoped API keys, enforces scopes, and revokes keys immediately', async () => {
    const manager = new ApiKeyManager(db);
    const issued = await manager.issueApiKey({
      tenantId: tenant1Id,
      name: 'ServiceTitan Sync Key',
      scopes: ['appointments:read', 'appointments:write'],
      expiresInDays: 30,
    });

    expect(issued.rawKey).toMatch(/^cs_live_/);

    const okCheck = await manager.verifyApiKey(issued.rawKey, 'appointments:write');
    expect(okCheck.valid).toBe(true);

    const deniedScope = await manager.verifyApiKey(issued.rawKey, 'billing:admin');
    expect(deniedScope.valid).toBe(false);
    if (!deniedScope.valid) {
      expect(deniedScope.reason).toBe('insufficient_scope');
    }

    await manager.revokeApiKey(tenant1Id, issued.apiKey.id);
    const afterRevoke = await manager.verifyApiKey(issued.rawKey);
    expect(afterRevoke.valid).toBe(false);
  });

  it('maintains a tamper-evident SHA-256 cryptographic hash chain across audit events', async () => {
    const chain = new AuditChainManager(db);
    const first = await chain.appendChainedAuditEvent({
      tenantId: tenant1Id,
      action: 'credential.rotated',
      resourceType: 'credential',
      resourceId: 'cred_1',
      details: { keyVersion: 2 },
    });
    const second = await chain.appendChainedAuditEvent({
      tenantId: tenant1Id,
      action: 'policy.updated',
      resourceType: 'settings',
      resourceId: 'settings_1',
      details: { retentionDays: 90 },
    });

    expect(second.prevHash).toBe(first.entryHash);

    const verification = await chain.verifyTenantAuditChain(tenant1Id);
    expect(verification.intact).toBe(true);
    expect(verification.verifiedCount).toBeGreaterThanOrEqual(2);
  });

  it('enforces progressive brute-force lockout, JTI token revocation, and fail-closed production secret checks', () => {
    const guard = new LoginBruteForceGuard({ maxFailures: 3, lockoutDurationMs: 60_000 });
    guard.recordFailure('attacker@example.com');
    guard.recordFailure('attacker@example.com');
    expect(guard.checkAllowed('attacker@example.com').allowed).toBe(true);

    const third = guard.recordFailure('attacker@example.com');
    expect(third.locked).toBe(true);
    expect(guard.checkAllowed('attacker@example.com').allowed).toBe(false);

    TokenRevocationList.revoke('jti_compromised_001');
    expect(TokenRevocationList.isRevoked('jti_compromised_001')).toBe(true);

    expect(() =>
      assertProductionSecretsConfigured({
        NODE_ENV: 'production',
        JWT_SECRET: 'default-change-me-jwt-secret-for-production!',
        ENCRYPTION_MASTER_KEY: 'a'.repeat(40),
      })
    ).toThrow(/FatalSecurityConfigError/);
  });
});
