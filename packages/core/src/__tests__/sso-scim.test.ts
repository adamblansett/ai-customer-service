import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabase, closeDatabase, seedDatabase } from '@customer-service/db';
import {
  SsoManager,
  ScimProvisioner,
  type TenantSsoConfig,
} from '../index.js';

describe('Enterprise Identity, SSO & SCIM 2.0 Suite', () => {
  let db: Awaited<ReturnType<typeof getDatabase>>;
  let tenantId: string;

  beforeAll(async () => {
    db = await getDatabase({ useEmbedded: true });
    const seed = await seedDatabase(db);
    tenantId = seed.tenant1Id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('SsoManager', () => {
    const ssoConfig: TenantSsoConfig = {
      tenantId: 'tenant_enterprise_001',
      protocol: 'saml',
      issuer: 'https://login.microsoftonline.com/example-tenant-id/v2.0',
      ssoLoginUrl: 'https://login.microsoftonline.com/example-tenant-id/saml2',
      groupRoleMapping: {
        'IT-Admins': 'owner',
        'Support-Supervisors': 'admin',
        'Tier1-Agents': 'agent',
      },
      defaultRole: 'agent',
    };

    it('parses SAML 2.0 assertion and correctly maps directory groups to tenant roles', () => {
      const mockSamlAssertion = `
        <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_resp_123">
          <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assert_456">
            <saml:Subject>
              <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">
                sarah.supervisor@enterprise.example.com
              </saml:NameID>
            </saml:Subject>
            <saml:AttributeStatement>
              <saml:Attribute Name="displayName">
                <saml:AttributeValue>Sarah Supervisor</saml:AttributeValue>
              </saml:Attribute>
              <saml:Attribute Name="email">
                <saml:AttributeValue>sarah.supervisor@enterprise.example.com</saml:AttributeValue>
              </saml:Attribute>
              <saml:Attribute Name="memberOf">
                <saml:AttributeValue>Support-Supervisors</saml:AttributeValue>
                <saml:AttributeValue>General-Employees</saml:AttributeValue>
              </saml:Attribute>
            </saml:AttributeStatement>
          </saml:Assertion>
        </samlp:Response>
      `;

      const profile = SsoManager.parseSamlResponse(mockSamlAssertion, ssoConfig);

      expect(profile.email).toBe('sarah.supervisor@enterprise.example.com');
      expect(profile.name).toBe('Sarah Supervisor');
      expect(profile.groups).toContain('Support-Supervisors');
      expect(profile.role).toBe('admin'); // Mapped via groupRoleMapping
    });

    it('parses OIDC claims and grants default role when no mapped group exists', () => {
      const oidcClaims = {
        sub: 'auth0|987654321',
        email: 'alex.agent@enterprise.example.com',
        name: 'Alex Agent',
        groups: ['Contractors'],
      };

      const profile = SsoManager.parseOidcToken(oidcClaims, ssoConfig);

      expect(profile.email).toBe('alex.agent@enterprise.example.com');
      expect(profile.role).toBe('agent'); // Fallback to defaultRole
    });

    it('prioritizes highest privilege role if user belongs to multiple mapped groups', () => {
      const mappedRole = SsoManager.mapGroupsToRole(
        ['Tier1-Agents', 'IT-Admins'],
        ssoConfig.groupRoleMapping,
        'agent'
      );

      expect(mappedRole).toBe('owner'); // 'IT-Admins' maps to owner, which beats agent
    });
  });

  describe('ScimProvisioner', () => {
    it('provisions new user via RFC 7644 SCIM 2.0 schema and syncs tenant membership', async () => {
      const provisioner = new ScimProvisioner(db);

      // 1. Create User
      const createdUser = await provisioner.createUser(tenantId, {
        userName: 'marcus.vance@acme-hvac.example.com',
        displayName: 'Marcus Vance',
        name: {
          formatted: 'Marcus Vance',
          givenName: 'Marcus',
          familyName: 'Vance',
        },
        emails: [{ value: 'marcus.vance@acme-hvac.example.com', primary: true }],
        active: true,
        roles: [{ value: 'agent' }],
      });

      expect(createdUser.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(createdUser.userName).toBe('marcus.vance@acme-hvac.example.com');
      expect(createdUser.active).toBe(true);
      expect(createdUser.roles?.[0].value).toBe('agent');

      // 2. Lookup User
      const fetchedUser = await provisioner.getUser(tenantId, createdUser.id);
      expect(fetchedUser).not.toBeNull();
      expect(fetchedUser?.id).toBe(createdUser.id);

      // 3. Patch User (Deprovision / Deactivate user)
      const patchedUser = await provisioner.patchUser(tenantId, createdUser.id, [
        { op: 'replace', path: 'active', value: false },
        { op: 'replace', path: 'roles', value: [{ value: 'admin' }] },
      ]);

      expect(patchedUser.active).toBe(false);
      expect(patchedUser.roles?.[0].value).toBe('admin');

      // 4. List Users
      const list = await provisioner.listUsers(tenantId, 1, 20);
      expect(list.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(list.Resources.some((u) => u.id === createdUser.id)).toBe(true);

      // 5. Delete User
      const deleted = await provisioner.deleteUser(tenantId, createdUser.id);
      expect(deleted).toBe(true);

      const afterDelete = await provisioner.getUser(tenantId, createdUser.id);
      expect(afterDelete).toBeNull();
    });
  });
});
