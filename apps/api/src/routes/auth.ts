import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { createAuthToken, authMiddleware } from '../middleware/auth.js';

export function createAuthRouter(db: DatabaseInstance): Router {
  const router = Router();

  // POST /api/v1/auth/login
  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase().trim()));

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid email or password.' });
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
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Fetch user tenant memberships
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
        memberships,
      },
    });
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
        memberships,
      },
    });
  });

  // POST /api/v1/auth/logout
  router.post('/logout', (_req: Request, res: Response): void => {
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'Logged out successfully.' });
  });

  return router;
}
