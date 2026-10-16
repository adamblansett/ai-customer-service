export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AiGenerateRequest {
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiGenerateResponse {
  content: string;
  toolCalls: AiToolCall[];
  usage: AiTokenUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface AiStreamChunk {
  textDelta?: string;
  toolCallDelta?: Partial<AiToolCall>;
  isFinished?: boolean;
}

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
}

// -------------------------------------------------------------
// Provider Errors & Retry Classification
// -------------------------------------------------------------

export class AiProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'AiProviderError';
  }
}

export class AiRateLimitError extends AiProviderError {
  constructor(provider: string, public readonly retryAfterSeconds?: number, message?: string) {
    super(provider, message || `Rate limit exceeded. Retry after ${retryAfterSeconds ?? 'unknown'} seconds.`, 429, true);
    this.name = 'AiRateLimitError';
  }
}

export class AiAuthError extends AiProviderError {
  constructor(provider: string, message?: string) {
    super(provider, message || 'Invalid credentials or API key.', 401, false);
    this.name = 'AiAuthError';
  }
}

export class AiTimeoutError extends AiProviderError {
  constructor(provider: string, message?: string) {
    super(provider, message || 'Provider request timed out.', 408, true);
    this.name = 'AiTimeoutError';
  }
}

export class AiContextLengthError extends AiProviderError {
  constructor(provider: string, message?: string) {
    super(provider, message || 'Maximum context length exceeded.', 400, false);
    this.name = 'AiContextLengthError';
  }
}
