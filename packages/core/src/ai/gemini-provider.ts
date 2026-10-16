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

export interface GeminiConfig {
  apiKey: string;
  defaultModel?: string;
  baseURL?: string;
}

export class GeminiProvider implements AiProvider {
  public readonly providerId = 'gemini';
  public readonly defaultModel: string;
  private apiKey: string;
  private baseURL: string;

  constructor(config: GeminiConfig) {
    this.defaultModel = config.defaultModel || 'gemini-1.5-flash';
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://generativelanguage.googleapis.com/v1beta';
  }

  getCapabilities(_model?: string): ModelCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 1000000,
    };
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const model = request.model || this.defaultModel;

    // Filter system instruction
    const systemInstruction = request.messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n');

    const contents = request.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const role = m.role === 'assistant' ? 'model' : 'user';
        if (m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'model',
            parts: m.toolCalls.map(tc => ({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            })),
          };
        }
        if (m.role === 'tool') {
          return {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: m.name || 'tool_response',
                  response: { content: m.content },
                },
              },
            ],
          };
        }
        return {
          role,
          parts: [{ text: m.content }],
        };
      });

    const body: Record<string, any> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.3,
        maxOutputTokens: request.maxTokens ?? 1024,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);

    try {
      const url = `${this.baseURL}/models/${model}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 400 && errorText.includes('API_KEY_INVALID')) {
          throw new AiAuthError(this.providerId, `Gemini API Key invalid: ${errorText}`);
        }
        if (response.status === 429) {
          throw new AiRateLimitError(this.providerId, 10, `Gemini rate limit exceeded: ${errorText}`);
        }
        throw new AiProviderError(this.providerId, `Gemini error (Status ${response.status}): ${errorText}`);
      }

      const json: any = await response.json();
      const candidate = json.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let content = '';
      const toolCalls: AiToolCall[] = [];

      for (const part of parts) {
        if (part.text) {
          content += part.text;
        } else if (part.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args || {},
          });
        }
      }

      return {
        content,
        toolCalls,
        usage: {
          promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
        },
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AiTimeoutError(this.providerId, 'Gemini request timed out.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    const full = await this.generate(request);
    yield { textDelta: full.content, isFinished: true };
  }
}
