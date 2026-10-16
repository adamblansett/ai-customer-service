import { AiProvider } from './provider.interface.js';
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiStreamChunk,
  ModelCapabilities,
  AiRateLimitError,
  AiAuthError,
  AiTimeoutError,
  AiContextLengthError,
  AiProviderError,
  AiToolCall,
} from './types.js';

export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  providerId?: string; // 'openai', 'groq', 'ollama', etc.
}

export class OpenAiCompatibleProvider implements AiProvider {
  public readonly providerId: string;
  public readonly defaultModel: string;
  private apiKey: string;
  private baseURL: string;

  constructor(config: OpenAiCompatibleConfig) {
    this.providerId = config.providerId || 'openai';
    this.defaultModel = config.defaultModel || (this.providerId === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || (this.providerId === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
  }

  getCapabilities(model?: string): ModelCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 128000,
    };
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const model = request.model || this.defaultModel;
    const body: Record<string, any> = {
      model,
      messages: request.messages.map(m => {
        if (m.role === 'tool') {
          return {
            role: 'tool',
            content: m.content,
            tool_call_id: m.toolCallId || 'call_1',
          };
        }
        if (m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: m.role,
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
        }
        return {
          role: m.role,
          content: m.content,
        };
      }),
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 1024,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);

    if (request.abortSignal) {
      request.abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const json: any = await response.json();
      const choice = json.choices?.[0];
      const message = choice?.message;

      const toolCalls: AiToolCall[] = [];
      if (message?.tool_calls) {
        for (const tc of message.tool_calls) {
          try {
            toolCalls.push({
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments || '{}'),
            });
          } catch {
            toolCalls.push({
              id: tc.id,
              name: tc.function.name,
              arguments: {},
            });
          }
        }
      }

      return {
        content: message?.content || '',
        toolCalls,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
          totalTokens: json.usage?.total_tokens ?? 0,
        },
        finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AiTimeoutError(this.providerId, 'AI provider request timed out or was cancelled.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    const model = request.model || this.defaultModel;
    const body: Record<string, any> = {
      model,
      stream: true,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 1024,
    };

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: request.abortSignal,
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    if (!response.body) {
      throw new AiProviderError(this.providerId, 'Empty response body from provider stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          if (trimmed === 'data: [DONE]') {
            yield { isFinished: true };
            return;
          }

          try {
            const data = JSON.parse(trimmed.slice(5).trim());
            const delta = data.choices?.[0]?.delta;
            if (delta?.content) {
              yield { textDelta: delta.content, isFinished: false };
            }
          } catch {
            // Ignore malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { isFinished: true };
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const errorBody = await response.text();
    const status = response.status;

    if (status === 401 || status === 403) {
      throw new AiAuthError(this.providerId, `Authentication failed (Status ${status}): ${errorBody}`);
    }

    if (status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 10;
      throw new AiRateLimitError(this.providerId, retryAfter, `Rate limit exceeded: ${errorBody}`);
    }

    if (status === 408 || status === 504) {
      throw new AiTimeoutError(this.providerId, `Provider timeout (Status ${status})`);
    }

    if (errorBody.toLowerCase().includes('context_length') || errorBody.toLowerCase().includes('maximum context')) {
      throw new AiContextLengthError(this.providerId, errorBody);
    }

    throw new AiProviderError(this.providerId, `Provider error (Status ${status}): ${errorBody}`, status, status >= 500);
  }
}
