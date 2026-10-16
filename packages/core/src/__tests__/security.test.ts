import { describe, it, expect } from 'vitest';
import { encryptCredential, decryptCredential, maskSecret } from '../security/encryption.js';
import { redactSensitiveData, sanitizeLogObject } from '../security/redaction.js';
import { hasPermission } from '../security/rbac.js';
import { assertTenantAccess } from '../security/tenant.js';

describe('Security & Encryption Subsystem', () => {
  const masterKey = 'super-secret-production-grade-master-key-32bytes!';

  it('encrypts and decrypts credentials using AES-256-GCM', () => {
    const rawApiKey = 'sk-proj-test1234567890abcdef1234567890';
    const encrypted = encryptCredential(rawApiKey, masterKey, 1);

    expect(encrypted.encryptedData).toBeDefined();
    expect(encrypted.iv).toHaveLength(24); // 12 bytes = 24 hex characters
    expect(encrypted.authTag).toHaveLength(32); // 16 bytes = 32 hex characters

    const decrypted = decryptCredential(encrypted, masterKey);
    expect(decrypted).toBe(rawApiKey);
  });

  it('fails decryption when ciphertext is tampered (authenticated encryption integrity check)', () => {
    const rawApiKey = 'sk-proj-test1234567890abcdef1234567890';
    const encrypted = encryptCredential(rawApiKey, masterKey, 1);

    // Tamper ciphertext
    const tampered = {
      ...encrypted,
      encryptedData: encrypted.encryptedData.slice(0, -2) + 'ff',
    };

    expect(() => decryptCredential(tampered, masterKey)).toThrow();
  });

  it('fails decryption when auth tag is tampered', () => {
    const rawApiKey = 'sk-proj-test1234567890abcdef1234567890';
    const encrypted = encryptCredential(rawApiKey, masterKey, 1);

    const tampered = {
      ...encrypted,
      authTag: '00'.repeat(16),
    };

    expect(() => decryptCredential(tampered, masterKey)).toThrow();
  });

  it('masks sensitive secrets for display safely', () => {
    expect(maskSecret('sk-1234567890abcdef')).toBe('sk-...cdef');
    expect(maskSecret('AC1234567890abcdef')).toBe('AC1...cdef');
    expect(maskSecret('short')).toBe('••••••••');
  });

  it('redacts credit cards, SSNs, and API keys from text and log objects', () => {
    const rawLog = 'User entered card 4111-2222-3333-4444 and ssn 123-45-6789 with key sk-1234567890123456789012345';
    const redacted = redactSensitiveData(rawLog);

    expect(redacted).not.toContain('4111-2222-3333-4444');
    expect(redacted).not.toContain('123-45-6789');
    expect(redacted).not.toContain('sk-1234567890123456789012345');
    expect(redacted).toContain('[REDACTED_CREDIT_CARD]');
    expect(redacted).toContain('[REDACTED_SSN]');
    expect(redacted).toContain('[REDACTED_API_KEY]');

    const obj = {
      user: 'alice',
      password: 'mypassword123',
      apiKey: 'secret123',
      nested: {
        token: 'jwt.token.val',
        info: 'regular info',
      },
    };
    const sanitizedObj = sanitizeLogObject(obj);
    expect(sanitizedObj.password).toBe('[REDACTED]');
    expect(sanitizedObj.apiKey).toBe('[REDACTED]');
    expect(sanitizedObj.nested.token).toBe('[REDACTED]');
    expect(sanitizedObj.nested.info).toBe('regular info');
  });

  it('strictly validates RBAC permissions per role', () => {
    expect(hasPermission('owner', 'credentials:write')).toBe(true);
    expect(hasPermission('admin', 'credentials:write')).toBe(true);
    expect(hasPermission('agent', 'credentials:write')).toBe(false);

    expect(hasPermission('agent', 'conversations:read')).toBe(true);
    expect(hasPermission('agent', 'conversations:assign')).toBe(true);
    expect(hasPermission('agent', 'tenant:delete')).toBe(false);
  });

  it('enforces tenant boundary assertions', () => {
    const context = { tenantId: 'tenant_a', role: 'admin' as const };

    expect(() => assertTenantAccess(context, 'tenant_a')).not.toThrow();
    expect(() => assertTenantAccess(context, 'tenant_b')).toThrow(/Cross-tenant access denied/);
  });
});
