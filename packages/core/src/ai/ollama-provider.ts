import { AiProvider } from './provider.interface.js';
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiStreamChunk,
  AiToolCall,
  ModelCapabilities,
  AiTimeoutError,
  AiProviderError,
} from './types.js';

export interface OllamaConfig {
  baseURL?: string; // defaults to BUILT_IN_AI_URL or 'http://localhost:11434'
  defaultModel?: string; // defaults to 'qwen2.5:7b-instruct' (Apache 2.0)
}

export class OllamaAiProvider implements AiProvider {
  public readonly providerId = 'ollama';
  public readonly defaultModel: string;
  private baseURL: string;

  constructor(config: OllamaConfig = {}) {
    this.baseURL = (
      config.baseURL ||
      process.env.BUILT_IN_AI_URL ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434'
    ).replace(/\/+$/, '');
    this.defaultModel =
      config.defaultModel ||
      process.env.BUILT_IN_AI_MODEL ||
      'qwen2.5:7b-instruct';
  }

  getCapabilities(_model?: string): ModelCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 128000,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseURL}/api/tags`);
      if (!res.ok) {
        throw new Error(`Ollama server returned status ${res.status}`);
      }
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return (data.models || []).map((m) => m.name);
    } catch (err: any) {
      throw new AiProviderError('ollama', `Failed to list Ollama models: ${err.message}`);
    }
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const model = request.model || this.defaultModel;
    const url = `${this.baseURL}/api/chat`;

    const formattedMessages = request.messages.map((m) => ({
      role: m.role === 'tool' ? 'tool' : m.role,
      content: m.content || '',
    }));

    const body: Record<string, any> = {
      model,
      messages: formattedMessages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.2,
        num_predict: request.maxTokens ?? 512,
      },
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 60000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new AiProviderError(
          'ollama',
          `Ollama generate failed (${res.status}): ${errorText}`,
          res.status
        );
      }

      const json = (await res.json()) as any;
      const content = json.message?.content || '';
      const rawToolCalls = json.message?.tool_calls || [];
      const toolCalls: AiToolCall[] = Array.isArray(rawToolCalls)
        ? rawToolCalls.map((tc: any, idx: number) => ({
            id: tc.id || `call_${idx + 1}`,
            name: tc.function?.name || tc.name || 'unknown_tool',
            arguments:
              typeof tc.function?.arguments === 'string'
                ? JSON.parse(tc.function.arguments || '{}')
                : tc.function?.arguments || tc.arguments || {},
          }))
        : [];
      const promptTokens = json.prompt_eval_count || 0;
      const completionTokens = json.eval_count || 0;

      return {
        content,
        toolCalls,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new AiTimeoutError('ollama', 'Ollama request timed out after 60s');
      }
      if (err instanceof AiProviderError) throw err;
      throw new AiProviderError('ollama', err.message);
    }
  }

  async *stream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    const model = request.model || this.defaultModel;
    const url = `${this.baseURL}/api/chat`;

    const body: Record<string, any> = {
      model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content || '',
      })),
      stream: true,
      options: {
        temperature: request.temperature ?? 0.2,
        num_predict: request.maxTokens ?? 512,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new AiProviderError('ollama', `Ollama stream request failed with status ${res.status}`);
    }

    if (!res.body) {
      throw new AiProviderError('ollama', 'No readable stream received from Ollama');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.message?.content) {
            yield {
              textDelta: parsed.message.content,
              isFinished: parsed.done || false,
            };
          }
        } catch {
          // Ignore partial line parses
        }
      }
    }
  }
}
