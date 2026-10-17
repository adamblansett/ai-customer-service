import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import { SsoManager, type TenantSsoConfig } from '@customer-service/core';
import { createAuthToken } from '../middleware/auth.js';

export function createSsoRouter(db: DatabaseInstance): Router {
  const router = Router();

  // POST /api/v1/auth/sso/:tenantId/saml - SAML 2.0 Assertion Consumer Service (ACS)
  router.post('/:tenantId/saml', async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.params.tenantId;
    const { SAMLResponse, xmlAssertion, mapping } = req.body;
    const rawXml = xmlAssertion || (SAMLResponse ? Buffer.from(SAMLResponse, 'base64').toString('utf8') : null);

    if (!rawXml) {
      res.status(400).json({ error: 'SAMLResponse or xmlAssertion is required.' });
      return;
    }

    try {
      const config: TenantSsoConfig = {
        tenantId,
        protocol: 'saml',
        issuer: req.body.issuer || 'https://idp.example.com',
        ssoLoginUrl: req.body.ssoLoginUrl || 'https://idp.example.com/sso',
        groupRoleMapping: mapping || {
          'CustomerService-Admins': 'admin',
          'Support-Supervisors': 'admin',
          'Support-Agents': 'agent',
        },
        defaultRole: 'agent',
      };

      const profile = SsoManager.parseSamlResponse(rawXml, config);

      // Upsert User
      let [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, profile.email.toLowerCase()));

      if (!user) {
        const [newUser] = await db
          .insert(schema.users)
          .values({
            id: randomUUID(),
            email: profile.email.toLowerCase(),
            passwordHash: 'SSO_SAML_EXTERNAL_AUTH',
            name: profile.name,
            isActive: true,
          })
          .returning();
        user = newUser;
      }

      // Upsert Tenant Membership with mapped role
      const [existingMembership] = await db
        .select()
        .from(schema.tenantMemberships)
        .where(
          and(
            eq(schema.tenantMemberships.tenantId, tenantId),
            eq(schema.tenantMemberships.userId, user.id)
          )
        );

      if (existingMembership) {
        await db
          .update(schema.tenantMemberships)
          .set({ role: profile.role })
          .where(eq(schema.tenantMemberships.id, existingMembership.id));
      } else {
        await db.insert(schema.tenantMemberships).values({
          id: randomUUID(),
          tenantId,
          userId: user.id,
          role: profile.role,
        });
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

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: profile.role,
        },
        profile,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'SAML authentication failed' });
    }
  });

  // POST /api/v1/auth/sso/:tenantId/oidc - OIDC Token Verification & Exchange
  router.post('/:tenantId/oidc', async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.params.tenantId;
    const { id_token, claims, mapping } = req.body;

    if (!id_token && !claims) {
      res.status(400).json({ error: 'id_token or claims payload is required.' });
      return;
    }

    try {
      const config: TenantSsoConfig = {
        tenantId,
        protocol: 'oidc',
        issuer: req.body.issuer || 'https://accounts.google.com',
        ssoLoginUrl: req.body.ssoLoginUrl || 'https://accounts.google.com/o/oauth2/v2/auth',
        groupRoleMapping: mapping || {
          'Admins': 'admin',
          'Agents': 'agent',
        },
        defaultRole: 'agent',
      };

      const profile = SsoManager.parseOidcToken(claims || id_token, config);

      let [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, profile.email.toLowerCase()));

      if (!user) {
        const [newUser] = await db
          .insert(schema.users)
          .values({
            id: randomUUID(),
            email: profile.email.toLowerCase(),
            passwordHash: 'SSO_OIDC_EXTERNAL_AUTH',
            name: profile.name,
            isActive: true,
          })
          .returning();
        user = newUser;
      }

      const [existingMembership] = await db
        .select()
        .from(schema.tenantMemberships)
        .where(
          and(
            eq(schema.tenantMemberships.tenantId, tenantId),
            eq(schema.tenantMemberships.userId, user.id)
          )
        );

      if (existingMembership) {
        await db
          .update(schema.tenantMemberships)
          .set({ role: profile.role })
          .where(eq(schema.tenantMemberships.id, existingMembership.id));
      } else {
        await db.insert(schema.tenantMemberships).values({
          id: randomUUID(),
          tenantId,
          userId: user.id,
          role: profile.role,
        });
      }

      const token = createAuthToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        systemRole: user.systemRole,
      });

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: profile.role,
        },
        profile,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'OIDC authentication failed' });
    }
  });

  return router;
}
