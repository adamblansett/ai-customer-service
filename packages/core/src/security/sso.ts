import type { TenantRole } from './rbac.js';

export interface TenantSsoConfig {
  tenantId: string;
  protocol: 'saml' | 'oidc';
  issuer: string;
  ssoLoginUrl: string;
  certOrPublicKey?: string;
  clientId?: string;
  clientSecret?: string;
  groupRoleMapping?: Record<string, TenantRole>;
  defaultRole?: TenantRole;
  autoProvisionUsers?: boolean;
}

export interface SsoAuthProfile {
  email: string;
  name: string;
  externalId: string;
  groups: string[];
  role: TenantRole;
}

export class SsoManager {
  /**
   * Resolves a directory group list to an internal tenant role.
   * Prioritizes highest permission: owner > admin > agent.
   */
  public static mapGroupsToRole(
    groups: string[] = [],
    mapping: Record<string, TenantRole> = {},
    defaultRole: TenantRole = 'agent'
  ): TenantRole {
    const roles: TenantRole[] = [];

    for (const group of groups) {
      const mapped = mapping[group];
      if (mapped) {
        roles.push(mapped);
      }
    }

    if (roles.includes('owner')) return 'owner';
    if (roles.includes('admin')) return 'admin';
    if (roles.includes('agent')) return 'agent';

    return defaultRole;
  }

  /**
   * Parses and validates a SAML 2.0 XML assertion.
   * Extracts NameID, email, name, and memberOf / group attributes.
   */
  public static parseSamlResponse(
    xmlAssertion: string,
    config: TenantSsoConfig
  ): SsoAuthProfile {
    if (!xmlAssertion || !xmlAssertion.includes('Assertion')) {
      throw new Error('Invalid SAML Response: missing Assertion block');
    }

    // 1. Extract NameID (Subject)
    const nameIdMatch = xmlAssertion.match(/<(?:\w+:)?NameID[^>]*>([^<]+)<\/(?:\w+:)?NameID>/i);
    const externalId = nameIdMatch ? nameIdMatch[1].trim() : '';

    // 2. Extract Email Attribute
    const emailMatch =
      xmlAssertion.match(/Attribute\s+Name="(?:email|mail|User\.Email|nameidentifer)"[^>]*>[\s\S]*?<(?:\w+:)?AttributeValue[^>]*>([^<]+)<\/(?:\w+:)?AttributeValue>/i) ||
      xmlAssertion.match(/AttributeValue[^>]*>([^<@\s]+@[^<@\s]+)<\/(?:\w+:)?AttributeValue>/i);
    const email = emailMatch ? emailMatch[1].trim() : externalId;

    if (!email || !email.includes('@')) {
      throw new Error('SAML Assertion missing valid email address attribute');
    }

    // 3. Extract Name / Display Name
    const nameMatch =
      xmlAssertion.match(/Attribute\s+Name="(?:displayName|name|fullName|User\.FullName)"[^>]*>[\s\S]*?<(?:\w+:)?AttributeValue[^>]*>([^<]+)<\/(?:\w+:)?AttributeValue>/i) ||
      xmlAssertion.match(/Attribute\s+Name="(?:givenName|firstName)"[^>]*>[\s\S]*?<(?:\w+:)?AttributeValue[^>]*>([^<]+)<\/(?:\w+:)?AttributeValue>/i);
    const name = nameMatch ? nameMatch[1].trim() : email.split('@')[0];

    // 4. Extract Groups / Roles
    const groups: string[] = [];
    const groupRegex = /<(?:\w+:)?AttributeValue[^>]*>([^<]+)<\/(?:\w+:)?AttributeValue>/gi;
    const groupBlockMatch = xmlAssertion.match(/Attribute\s+Name="(?:groups|memberOf|roles|Group)"[^>]*>([\s\S]*?)<\/(?:\w+:)?Attribute>/gi);

    if (groupBlockMatch) {
      for (const block of groupBlockMatch) {
        let match;
        while ((match = groupRegex.exec(block)) !== null) {
          groups.push(match[1].trim());
        }
      }
    }

    const role = this.mapGroupsToRole(groups, config.groupRoleMapping, config.defaultRole || 'agent');

    return {
      email,
      name,
      externalId: externalId || email,
      groups,
      role,
    };
  }

  /**
   * Parses and validates an OIDC ID token claims payload.
   */
  public static parseOidcToken(
    tokenOrPayload: string | Record<string, any>,
    config: TenantSsoConfig
  ): SsoAuthProfile {
    let claims: Record<string, any>;

    if (typeof tokenOrPayload === 'string') {
      try {
        const parts = tokenOrPayload.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
          claims = JSON.parse(payloadJson);
        } else {
          claims = JSON.parse(tokenOrPayload);
        }
      } catch (err) {
        throw new Error('Invalid OIDC token format');
      }
    } else {
      claims = tokenOrPayload;
    }

    const email = claims.email || claims.preferred_username || claims.upn;
    if (!email || !email.includes('@')) {
      throw new Error('OIDC claims missing valid email address');
    }

    const name = claims.name || claims.display_name || email.split('@')[0];
    const externalId = claims.sub || email;

    const rawGroups = claims.groups || claims.roles || claims['cognito:groups'] || [];
    const groups = Array.isArray(rawGroups) ? rawGroups : [rawGroups];

    const role = this.mapGroupsToRole(groups, config.groupRoleMapping, config.defaultRole || 'agent');

    return {
      email,
      name,
      externalId,
      groups,
      role,
    };
  }
}
