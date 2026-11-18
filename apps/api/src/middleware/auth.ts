import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import {
  TenantRole,
  TokenRevocationList,
  assertProductionSecretsConfigured,
  ApiKeyManager,
} from '@customer-service/core';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  systemRole: string;
  jti?: string;
  apiKeyTenantId?: string;
  apiKeyScopes?: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      tenantMembership?: {
        tenantId: string;
        role: TenantRole;
      };
      correlationId?: string;
      rawApiKey?: string;
    }
  }
}

assertProductionSecretsConfigured();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt-secret-replace-in-production-12345';

export function createAuthToken(user: AuthenticatedUser): string {
  const jti = user.jti || `jti_${crypto.randomUUID()}`;
  return jwt.sign({ ...user, jti }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '7d',
    issuer: 'ai-customer-service',
  });
}

export function verifyRawAuthToken(token: string): AuthenticatedUser {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
  }) as AuthenticatedUser;

  if (TokenRevocationList.isRevoked(decoded.jti)) {
    throw new Error('TokenRevoked: Session token has been logged out or revoked.');
  }

  return decoded;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const headerApiKey = req.headers['x-api-key'] as string | undefined;
  const queryToken = req.path.endsWith('/events/stream') ? (req.query?.token as string) : undefined;

  // 1. Check for Scoped M2M API Key (`Bearer cs_live_...` or `X-API-Key: cs_live_...`)
  const candidateApiKey =
    headerApiKey ||
    (authHeader?.startsWith('Bearer cs_live_') ? authHeader.slice(7).trim() : undefined);

  if (candidateApiKey && candidateApiKey.startsWith('cs_live_')) {
    req.rawApiKey = candidateApiKey;
    req.user = {
      userId: 'm2m_api_key',
      email: 'api-key@m2m.internal',
      name: 'Scoped M2M API Key',
      systemRole: 'm2m',
    };
    next();
    return;
  }

  // 2. Check CSRF Origin Guard when authenticating solely via cookie on state-changing methods
  const usedCookieOnly = !authHeader && Boolean(req.cookies?.auth_token);
  if (usedCookieOnly && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    const reqOrigin = req.headers.origin;
    const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim());
    if (reqOrigin && !allowedOrigins.includes(reqOrigin)) {
      res.status(403).json({
        error: `CSRFBlocked: Untrusted cross-site Origin '${reqOrigin}' on cookie-authenticated request.`,
      });
      return;
    }
  }

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies?.auth_token || queryToken;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Missing authentication token.' });
    return;
  }

  try {
    req.user = verifyRawAuthToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid, revoked, or expired token.' });
  }
}

/**
 * Validates that the authenticated user (or scoped M2M API key) is authorized for the requested tenant.
 */
export function requireTenantRole(
  db: DatabaseInstance,
  allowedRoles: TenantRole[] = ['owner', 'admin', 'agent']
) {
  const apiKeyManager = new ApiKeyManager(db);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tenantId = req.params.tenantId || req.body?.tenantId || (req.query?.tenantId as string);

    if (!tenantId) {
      res.status(400).json({ error: 'BadRequest: Missing tenant ID parameter.' });
      return;
    }

    // Verify M2M API Key against SHA-256 hash & strict tenant isolation
    if (req.rawApiKey) {
      const check = await apiKeyManager.verifyApiKey(req.rawApiKey);
      if (!check.valid) {
        res.status(401).json({ error: `Unauthorized: Invalid or revoked API key (${check.reason}).` });
        return;
      }
      if (check.tenantId !== tenantId) {
        res.status(403).json({
          error: 'Forbidden: Scoped API key is not authorized for this tenant.',
        });
        return;
      }
      req.user.userId = check.keyId;
      req.user.apiKeyTenantId = check.tenantId;
      req.user.apiKeyScopes = check.scopes;
      req.tenantMembership = { tenantId, role: 'admin' };
      next();
      return;
    }

    try {
      const [membership] = await db
        .select()
        .from(schema.tenantMemberships)
        .where(
          and(
            eq(schema.tenantMemberships.tenantId, tenantId),
            eq(schema.tenantMemberships.userId, req.user.userId)
          )
        );

      if (!membership) {
        res.status(403).json({
          error: `Forbidden: User '${req.user.email}' is not a member of tenant '${tenantId}'. Cross-tenant access denied.`,
        });
        return;
      }

      const userRole = membership.role as TenantRole;
      if (!allowedRoles.includes(userRole)) {
        res.status(403).json({
          error: `Forbidden: Required role [${allowedRoles.join(', ')}], but user holds role '${userRole}'.`,
        });
        return;
      }

      req.tenantMembership = {
        tenantId,
        role: userRole,
      };

      next();
    } catch {
      res.status(500).json({ error: 'InternalServerError: Failed to verify tenant authorization.' });
    }
  };
}
