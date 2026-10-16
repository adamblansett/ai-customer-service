export interface TenantContext {
  tenantId: string;
  userId?: string;
  role?: 'owner' | 'admin' | 'agent';
}

/**
 * Validates that an operation belongs strictly to the authenticated tenant.
 * Rejects any cross-tenant ID mismatch.
 */
export function assertTenantAccess(context: TenantContext, requestedTenantId: string): void {
  if (!context || !context.tenantId) {
    throw new Error('TenantAuthorizationError: No active tenant context provided.');
  }

  if (context.tenantId !== requestedTenantId) {
    throw new Error(
      `TenantAuthorizationError: Cross-tenant access denied. Context tenant '${context.tenantId}' cannot access resource in tenant '${requestedTenantId}'.`
    );
  }
}
