import { OpenAiCompatibleProvider } from './openai-compatible.js';
import { ModelCapabilities } from './types.js';

export interface VllmConfig {
  baseURL?: string; // defaults to 'http://localhost:8000/v1'
  apiKey?: string; // defaults to 'EMPTY'
  defaultModel?: string;
}

export class VllmAiProvider extends OpenAiCompatibleProvider {
  constructor(config: VllmConfig = {}) {
    super({
      apiKey: config.apiKey || 'EMPTY',
      baseURL: (config.baseURL || 'http://localhost:8000/v1').replace(/\/+$/, ''),
      defaultModel: config.defaultModel || 'meta-llama/Llama-3.3-70B-Instruct',
      providerId: 'vllm',
    });
  }

  override getCapabilities(_model?: string): ModelCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 131072, // vLLM FlashAttention supports long contexts
    };
  }

  async listModels(): Promise<string[]> {
    const url = `${(this as any).baseURL}/models`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${(this as any).apiKey}`,
      },
    });

    if (!res.ok) {
      throw new Error(`vLLM server returned status ${res.status}`);
    }

    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data || []).map((m) => m.id);
  }
}
