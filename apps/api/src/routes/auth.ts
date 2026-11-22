import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { createAuthToken, authMiddleware, verifyRawAuthToken } from '../middleware/auth.js';
import {
  LoginBruteForceGuard,
  TokenRevocationList,
  TotpMfaManager,
  WebAuthnPasskeyManager,
  OnboardingService,
  INDUSTRY_TEMPLATES,
  encryptCredential,
  decryptCredential,
} from '@customer-service/core';

const loginBruteForceGuard = new LoginBruteForceGuard({
  maxFailures: 5,
  lockoutDurationMs: 15 * 60_000,
});

export function createAuthRouter(db: DatabaseInstance): Router {
  const router = Router();
  const passkeyManager = new WebAuthnPasskeyManager(db);
  const onboarding = new OnboardingService(db);

  // GET /api/v1/auth/onboarding/templates - Public list of industry starter packs
  router.get('/onboarding/templates', (_req: Request, res: Response): void => {
    res.json({ templates: Object.values(INDUSTRY_TEMPLATES) });
  });

  // POST /api/v1/auth/signup - Self-serve workspace registration + 14-day trial + industry seed
  router.post('/signup', async (req: Request, res: Response): Promise<void> => {
    try {
      const created = await onboarding.registerWorkspace(req.body);
      const token = createAuthToken({
        userId: created.user.id,
        email: created.user.email,
        name: created.user.name,
        systemRole: created.user.systemRole,
      });

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.status(201).json({
        token,
        tenant: created.tenant,
        seeded: created.seeded,
        tier: created.tier,
        user: {
          ...created.user,
          mfaEnabled: false,
          memberships: [
            {
              tenantId: created.tenant.id,
              tenantName: created.tenant.name,
              tenantSlug: created.tenant.slug,
              role: 'owner',
            },
          ],
        },
      });
    } catch (err: any) {
      const msg = err.message || 'Workspace signup failed.';
      const status = msg.startsWith('ConflictError') ? 409 : 400;
      res.status(status).json({ error: msg });
    }
  });

  // POST /api/v1/auth/login (Protected by progressive brute-force lockout & optional RFC 6238 TOTP MFA)
  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const { email, password, totpCode } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const lockKey = `${normalizedEmail}:${req.ip || 'local'}`;
    const lockStatus = loginBruteForceGuard.checkAllowed(lockKey);

    if (!lockStatus.allowed) {
      res.setHeader('Retry-After', String(lockStatus.retryAfterSeconds));
      res.status(429).json({
        error: 'AccountTemporarilyLocked: Too many failed login attempts. Try again later.',
        retryAfterSeconds: lockStatus.retryAfterSeconds,
      });
      return;
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizedEmail));

    if (!user || !user.isActive) {
      loginBruteForceGuard.recordFailure(lockKey);
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      const failure = loginBruteForceGuard.recordFailure(lockKey);
      res.status(401).json({
        error: 'Invalid email or password.',
        accountLocked: failure.locked,
      });
      return;
    }

    // Enforce TOTP MFA if enabled on the account
    if (user.mfaEnabled && user.mfaSecretEncrypted) {
      if (!totpCode) {
        res.status(401).json({
          error: 'MfaRequired: Multi-factor authentication code is required.',
          mfaRequired: true,
        });
        return;
      }

      const parsedSecret = JSON.parse(user.mfaSecretEncrypted);
      const rawSecret = decryptCredential(parsedSecret);
      const mfaValid = TotpMfaManager.verifyTotpCode(rawSecret, String(totpCode));
      if (!mfaValid) {
        loginBruteForceGuard.recordFailure(lockKey);
        res.status(401).json({ error: 'Invalid MFA verification code.' });
        return;
      }
    }

    loginBruteForceGuard.reset(lockKey);

    const token = createAuthToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      systemRole: user.systemRole,
    });

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const memberships = await db
      .select({
        membershipId: schema.tenantMemberships.id,
        tenantId: schema.tenantMemberships.tenantId,
        role: schema.tenantMemberships.role,
        tenantName: schema.tenants.name,
        tenantSlug: schema.tenants.slug,
      })
      .from(schema.tenantMemberships)
      .innerJoin(schema.tenants, eq(schema.tenantMemberships.tenantId, schema.tenants.id))
      .where(eq(schema.tenantMemberships.userId, user.id));

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        systemRole: user.systemRole,
        mfaEnabled: user.mfaEnabled,
        memberships,
      },
    });
  });

  // POST /api/v1/auth/mfa/enroll - Generate encrypted RFC 6238 TOTP secret & otpauth URI
  router.post('/mfa/enroll', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    const enrollment = TotpMfaManager.generateEnrollment(req.user!.email);
    const encrypted = encryptCredential(enrollment.secretBase32);

    await db
      .update(schema.users)
      .set({
        mfaSecretEncrypted: JSON.stringify(encrypted),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, req.user!.userId));

    res.json({
      secretBase32: enrollment.secretBase32,
      otpauthUri: enrollment.otpauthUri,
      backupCodes: enrollment.backupCodes,
    });
  });

  // POST /api/v1/auth/mfa/enable - Verify 6-digit TOTP code and activate MFA enforcement
  router.post('/mfa/enable', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    const { totpCode } = req.body;
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, req.user!.userId));

    if (!user?.mfaSecretEncrypted) {
      res.status(400).json({ error: 'MFA enrollment not initialized.' });
      return;
    }

    const secretBase32 = decryptCredential(JSON.parse(user.mfaSecretEncrypted));
    if (!TotpMfaManager.verifyTotpCode(secretBase32, String(totpCode || ''))) {
      res.status(400).json({ error: 'Invalid 6-digit TOTP verification code.' });
      return;
    }

    await db
      .update(schema.users)
      .set({ mfaEnabled: true, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    res.json({ success: true, mfaEnabled: true });
  });

  // GET /api/v1/auth/me
  router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, req.user.userId));

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const memberships = await db
      .select({
        membershipId: schema.tenantMemberships.id,
        tenantId: schema.tenantMemberships.tenantId,
        role: schema.tenantMemberships.role,
        tenantName: schema.tenants.name,
        tenantSlug: schema.tenants.slug,
      })
      .from(schema.tenantMemberships)
      .innerJoin(schema.tenants, eq(schema.tenantMemberships.tenantId, schema.tenants.id))
      .where(eq(schema.tenantMemberships.userId, user.id));

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        systemRole: user.systemRole,
        mfaEnabled: user.mfaEnabled,
        memberships,
      },
    });
  });

  // POST /api/v1/auth/logout (Revokes active JWT jti immediately)
  router.post('/logout', (req: Request, res: Response): void => {
    const authHeader = req.headers.authorization;
    const rawToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.cookies?.auth_token;

    if (rawToken) {
      try {
        const decoded = verifyRawAuthToken(rawToken);
        if (decoded.jti) {
          TokenRevocationList.revoke(decoded.jti);
        }
      } catch {
        // Already invalid/expired
      }
    }

    res.clearCookie('auth_token');
    res.json({ success: true, tokenRevoked: true, message: 'Logged out and session token revoked.' });
  });

  // ============================================================================
  // WebAuthn / FIDO2 Passkey Passwordless Authentication Endpoints
  // ============================================================================
  router.post(
    '/passkey/register/options',
    authMiddleware,
    async (req: Request, res: Response): Promise<void> => {
      const options = passkeyManager.generateRegistrationOptions({
        id: req.user!.userId,
        email: req.user!.email,
        name: req.user!.name,
      });
      res.json(options);
    }
  );

  router.post(
    '/passkey/register/verify',
    authMiddleware,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stored = await passkeyManager.verifyAndStoreRegistration({
          userId: req.user!.userId,
          ...req.body,
        });
        res.status(201).json({
          passkey: {
            id: stored.id,
            credentialId: stored.credentialId,
            deviceName: stored.deviceName,
            algorithm: stored.algorithm,
            signCount: stored.signCount,
            createdAt: stored.createdAt,
          },
        });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Passkey registration verification failed.' });
      }
    }
  );

  router.post('/passkey/login/options', async (req: Request, res: Response): Promise<void> => {
    const options = await passkeyManager.generateAuthenticationOptions(req.body?.email);
    res.json(options);
  });

  router.post('/passkey/login/verify', async (req: Request, res: Response): Promise<void> => {
    try {
      const verified = await passkeyManager.verifyAuthentication(req.body);
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, verified.userId));

      if (!user || !user.isActive) {
        res.status(401).json({ error: 'Account inactive or not found.' });
        return;
      }

      const token = createAuthToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        systemRole: user.systemRole,
      });

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      const memberships = await db
        .select({
          membershipId: schema.tenantMemberships.id,
          tenantId: schema.tenantMemberships.tenantId,
          role: schema.tenantMemberships.role,
          tenantName: schema.tenants.name,
          tenantSlug: schema.tenants.slug,
        })
        .from(schema.tenantMemberships)
        .innerJoin(schema.tenants, eq(schema.tenantMemberships.tenantId, schema.tenants.id))
        .where(eq(schema.tenantMemberships.userId, user.id));

      res.json({
        token,
        passkeyAuthenticated: true,
        signCount: verified.newSignCount,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          systemRole: user.systemRole,
          mfaEnabled: user.mfaEnabled,
          memberships,
        },
      });
    } catch (err: any) {
      res.status(401).json({ error: err.message || 'Passkey login failed.' });
    }
  });

  router.get(
    '/passkey/credentials',
    authMiddleware,
    async (req: Request, res: Response): Promise<void> => {
      const credentials = await passkeyManager.listUserPasskeys(req.user!.userId);
      res.json({ credentials });
    }
  );

  router.delete(
    '/passkey/credentials/:id',
    authMiddleware,
    async (req: Request, res: Response): Promise<void> => {
      const deleted = await passkeyManager.revokePasskey(req.user!.userId, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Passkey not found.' });
        return;
      }
      res.json({ success: true });
    }
  );

  return router;
}
