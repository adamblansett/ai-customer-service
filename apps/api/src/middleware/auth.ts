import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { TenantRole, hasPermission, Permission } from '@customer-service/core';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  systemRole: string;
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
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt-secret-replace-in-production-12345';

export function createAuthToken(user: AuthenticatedUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies?.auth_token;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Missing authentication token.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
  }
}

/**
 * Validates that the authenticated user is a verified member of the requested tenant,
 * and possesses one of the required roles.
 */
export function requireTenantRole(db: DatabaseInstance, allowedRoles: TenantRole[] = ['owner', 'admin', 'agent']) {
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
    } catch (err: any) {
      res.status(500).json({ error: 'InternalServerError: Failed to verify tenant authorization.' });
    }
  };
}
