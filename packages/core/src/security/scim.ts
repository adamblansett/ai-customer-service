import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@customer-service/db/schema';
import type { DatabaseInstance } from '@customer-service/db';
import type { TenantRole } from './rbac.js';

export interface ScimName {
  formatted?: string;
  familyName?: string;
  givenName?: string;
}

export interface ScimEmail {
  value: string;
  primary?: boolean;
  type?: string;
}

export interface ScimRole {
  value: string;
  display?: string;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  userName: string;
  name?: ScimName;
  displayName?: string;
  emails?: ScimEmail[];
  active: boolean;
  roles?: ScimRole[];
  meta?: {
    resourceType: 'User';
    created: string;
    lastModified: string;
  };
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimPatchOperation {
  op: string; // 'add' | 'replace' | 'remove'
  path?: string;
  value: any;
}

export class ScimProvisioner {
  private db: DatabaseInstance;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  public static formatScimUser(
    user: typeof schema.users.$inferSelect,
    role: TenantRole = 'agent'
  ): ScimUserResource {
    const names = user.name.split(' ');
    const givenName = names[0] || user.name;
    const familyName = names.slice(1).join(' ') || '';

    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.id,
      userName: user.email,
      displayName: user.name,
      name: {
        formatted: user.name,
        givenName,
        familyName,
      },
      emails: [
        {
          value: user.email,
          primary: true,
          type: 'work',
        },
      ],
      active: user.isActive,
      roles: [
        {
          value: role,
          display: role.toUpperCase(),
        },
      ],
      meta: {
        resourceType: 'User',
        created: user.createdAt.toISOString(),
        lastModified: user.updatedAt.toISOString(),
      },
    };
  }

  public async listUsers(
    tenantId: string,
    startIndex: number = 1,
    count: number = 50
  ): Promise<ScimListResponse<ScimUserResource>> {
    const memberships = await this.db
      .select({
        user: schema.users,
        membership: schema.tenantMemberships,
      })
      .from(schema.tenantMemberships)
      .innerJoin(schema.users, eq(schema.tenantMemberships.userId, schema.users.id))
      .where(eq(schema.tenantMemberships.tenantId, tenantId))
      .limit(count)
      .offset(Math.max(0, startIndex - 1));

    const resources = memberships.map((row) =>
      ScimProvisioner.formatScimUser(row.user, row.membership.role as TenantRole)
    );

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: resources.length,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  public async getUser(tenantId: string, userId: string): Promise<ScimUserResource | null> {
    const [row] = await this.db
      .select({
        user: schema.users,
        membership: schema.tenantMemberships,
      })
      .from(schema.tenantMemberships)
      .innerJoin(schema.users, eq(schema.tenantMemberships.userId, schema.users.id))
      .where(
        and(
          eq(schema.tenantMemberships.tenantId, tenantId),
          eq(schema.tenantMemberships.userId, userId)
        )
      );

    if (!row) return null;
    return ScimProvisioner.formatScimUser(row.user, row.membership.role as TenantRole);
  }

  public async createUser(
    tenantId: string,
    payload: Partial<ScimUserResource>
  ): Promise<ScimUserResource> {
    const email =
      payload.userName || (payload.emails && payload.emails[0]?.value);
    if (!email) {
      throw new Error('SCIM Error: userName or email is required.');
    }

    const name =
      payload.displayName ||
      payload.name?.formatted ||
      [payload.name?.givenName, payload.name?.familyName].filter(Boolean).join(' ') ||
      email.split('@')[0];

    const role = (payload.roles?.[0]?.value as TenantRole) || 'agent';
    const isActive = payload.active !== undefined ? payload.active : true;

    // Check if user already exists
    const [existingUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()));

    let userId: string;
    let userRecord: typeof schema.users.$inferSelect;

    if (existingUser) {
      userId = existingUser.id;
      userRecord = existingUser;
    } else {
      userId = randomUUID();
      const [newUser] = await this.db
        .insert(schema.users)
        .values({
          id: userId,
          email: email.toLowerCase(),
          passwordHash: 'SSO_SCIM_PROVISIONED_ACCOUNT',
          name,
          isActive,
        })
        .returning();
      userRecord = newUser;
    }

    // Link or update tenant membership
    const [existingMembership] = await this.db
      .select()
      .from(schema.tenantMemberships)
      .where(
        and(
          eq(schema.tenantMemberships.tenantId, tenantId),
          eq(schema.tenantMemberships.userId, userId)
        )
      );

    if (!existingMembership) {
      await this.db.insert(schema.tenantMemberships).values({
        id: randomUUID(),
        tenantId,
        userId,
        role,
      });
    }

    return ScimProvisioner.formatScimUser(userRecord, role);
  }

  public async patchUser(
    tenantId: string,
    userId: string,
    operations: ScimPatchOperation[]
  ): Promise<ScimUserResource> {
    const existing = await this.getUser(tenantId, userId);
    if (!existing) {
      throw new Error(`SCIM Error: User ${userId} not found in tenant.`);
    }

    let active = existing.active;
    let role = (existing.roles?.[0]?.value as TenantRole) || 'agent';

    for (const op of operations) {
      const opType = op.op.toLowerCase();
      if (opType === 'replace' || opType === 'add') {
        if (op.path === 'active' || op.value?.active !== undefined) {
          active = Boolean(op.path === 'active' ? op.value : op.value.active);
        }
        if (op.path === 'roles' || op.value?.roles) {
          const newRoles = op.path === 'roles' ? op.value : op.value.roles;
          if (Array.isArray(newRoles) && newRoles[0]?.value) {
            role = newRoles[0].value as TenantRole;
          }
        }
      }
    }

    // Update user active status
    const [updatedUser] = await this.db
      .update(schema.users)
      .set({
        isActive: active,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();

    // Update tenant membership role
    await this.db
      .update(schema.tenantMemberships)
      .set({ role })
      .where(
        and(
          eq(schema.tenantMemberships.tenantId, tenantId),
          eq(schema.tenantMemberships.userId, userId)
        )
      );

    return ScimProvisioner.formatScimUser(updatedUser, role);
  }

  public async deleteUser(tenantId: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.tenantMemberships)
      .where(
        and(
          eq(schema.tenantMemberships.tenantId, tenantId),
          eq(schema.tenantMemberships.userId, userId)
        )
      )
      .returning();

    return deleted.length > 0;
  }
}
