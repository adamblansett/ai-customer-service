export type ToolCategory = 'read_only' | 'consequential' | 'prohibited';

export interface ToolExecutionContext {
  tenantId: string;
  conversationId: string;
  customerId?: string;
  callerPhone?: string;
  userId?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  requiresConfirmation?: boolean;
}

export class ProhibitedToolError extends Error {
  constructor(public readonly toolName: string, reason?: string) {
    super(reason || `ProhibitedActionError: Tool '${toolName}' is prohibited for autonomous AI execution.`);
    this.name = 'ProhibitedToolError';
  }
}

export class ToolAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolAuthorizationError';
  }
}
