import { AiProvider } from './provider.interface.js';
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiStreamChunk,
  ModelCapabilities,
  AiRateLimitError,
  AiAuthError,
  AiTimeoutError,
  AiProviderError,
  AiToolCall,
} from './types.js';

export interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class AnthropicProvider implements AiProvider {
  public readonly providerId = 'anthropic';
  public readonly defaultModel: string;
  private apiKey: string;
  private baseURL: string;

  constructor(config: AnthropicConfig) {
    this.defaultModel = config.defaultModel || 'claude-3-5-haiku-20241022';
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://api.anthropic.com/v1';
  }

  getCapabilities(_model?: string): ModelCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 200000,
    };
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const model = request.model || this.defaultModel;

    // Separate system messages
    const systemMessages = request.messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n');

    const conversationMessages = request.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.toolCalls.map(tc => ({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              })),
            ],
          };
        }
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.toolCallId || 'tool_1',
                content: m.content,
              },
            ],
          };
        }
        return {
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        };
      });

    const body: Record<string, any> = {
      model,
      messages: conversationMessages,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.3,
    };

    if (systemMessages) {
      body.system = systemMessages;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);

    if (request.abortSignal) {
      request.abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401 || response.status === 403) {
          throw new AiAuthError(this.providerId, `Anthropic authentication failed: ${errorText}`);
        }
        if (response.status === 429) {
          throw new AiRateLimitError(this.providerId, 10, `Anthropic rate limit: ${errorText}`);
        }
        throw new AiProviderError(this.providerId, `Anthropic error (Status ${response.status}): ${errorText}`);
      }

      const json: any = await response.json();
      let textContent = '';
      const toolCalls: AiToolCall[] = [];

      for (const block of json.content || []) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input,
          });
        }
      }

      return {
        content: textContent,
        toolCalls,
        usage: {
          promptTokens: json.usage?.input_tokens ?? 0,
          completionTokens: json.usage?.output_tokens ?? 0,
          totalTokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
        },
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AiTimeoutError(this.providerId, 'Anthropic request timed out.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    // Basic streaming fallback via generate
    const full = await this.generate(request);
    yield { textDelta: full.content, isFinished: true };
  }
}
