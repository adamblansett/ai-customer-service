export type TenantRole = 'owner' | 'admin' | 'agent';

export type Permission =
  | 'tenant:read'
  | 'tenant:update'
  | 'tenant:delete'
  | 'members:manage'
  | 'credentials:read'
  | 'credentials:write'
  | 'knowledge:read'
  | 'knowledge:write'
  | 'conversations:read'
  | 'conversations:write'
  | 'conversations:assign'
  | 'calls:manage'
  | 'audit:read';

const ROLE_PERMISSIONS: Record<TenantRole, Permission[]> = {
  owner: [
    'tenant:read',
    'tenant:update',
    'tenant:delete',
    'members:manage',
    'credentials:read',
    'credentials:write',
    'knowledge:read',
    'knowledge:write',
    'conversations:read',
    'conversations:write',
    'conversations:assign',
    'calls:manage',
    'audit:read',
  ],
  admin: [
    'tenant:read',
    'tenant:update',
    'members:manage',
    'credentials:read',
    'credentials:write',
    'knowledge:read',
    'knowledge:write',
    'conversations:read',
    'conversations:write',
    'conversations:assign',
    'calls:manage',
    'audit:read',
  ],
  agent: [
    'tenant:read',
    'knowledge:read',
    'conversations:read',
    'conversations:write',
    'conversations:assign',
    'calls:manage',
  ],
};

export function hasPermission(role: TenantRole | undefined, permission: Permission): boolean {
  if (!role) return false;
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.includes(permission);
}
