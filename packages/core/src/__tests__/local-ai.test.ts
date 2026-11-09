import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OllamaAiProvider,
  VllmAiProvider,
  ResilientBuiltInAiProvider,
  BUILT_IN_OPEN_WEIGHT_MODELS,
  createAiProvider,
  AiProviderError,
} from '../ai/index.js';

describe('Local & Air-Gapped AI Model Adapters (Ollama & vLLM)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('OllamaAiProvider & Built-In Qwen 2.5 Open-Weights', () => {
    it('defaults to qwen2.5:7b-instruct (Apache 2.0) and reports 128k context', () => {
      const provider = new OllamaAiProvider();
      expect(provider.defaultModel).toBe('qwen2.5:7b-instruct');
      const caps = provider.getCapabilities();
      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.maxContextTokens).toBe(128000);
      expect(BUILT_IN_OPEN_WEIGHT_MODELS['qwen2.5:7b-instruct'].license).toBe('Apache-2.0');
      expect(BUILT_IN_OPEN_WEIGHT_MODELS['qwen2.5:3b'].quantizedSizeGb).toBe(1.9);
      expect(BUILT_IN_OPEN_WEIGHT_MODELS['llama3.1:8b'].quantizedSizeGb).toBe(4.7);
      expect(BUILT_IN_OPEN_WEIGHT_MODELS['llama3.2:3b'].quantizedSizeGb).toBe(2.0);
      expect(BUILT_IN_OPEN_WEIGHT_MODELS['mistral-small:24b'].license).toBe('Apache-2.0');
      expect(Object.keys(BUILT_IN_OPEN_WEIGHT_MODELS)).toHaveLength(5);
    });

    it('supports native tool calling with Qwen 2.5 via Ollama /api/chat', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'qwen2.5:7b-instruct',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'escalate_to_human',
                  arguments: { reason: 'Emergency gas leak reported' },
                },
              },
            ],
          },
          prompt_eval_count: 42,
          eval_count: 15,
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OllamaAiProvider();
      const response = await provider.generate({
        messages: [{ role: 'user', content: 'I smell gas near my furnace!' }],
        tools: [
          {
            name: 'escalate_to_human',
            description: 'Transfer caller to human representative',
            parameters: {
              type: 'object',
              properties: { reason: { type: 'string' } },
              required: ['reason'],
            },
          },
        ],
      });

      expect(response.finishReason).toBe('tool_calls');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0].name).toBe('escalate_to_human');
      expect(response.toolCalls[0].arguments).toEqual({
        reason: 'Emergency gas leak reported',
      });
    });

    it('ResilientBuiltInAiProvider falls back gracefully when Ollama daemon is offline', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const builtIn = new ResilientBuiltInAiProvider({ model: 'qwen2.5:3b' });
      expect(builtIn.defaultModel).toBe('qwen2.5:3b');

      const response = await builtIn.generate({
        messages: [{ role: 'user', content: 'What are your operating hours?' }],
      });

      expect(response.content).toBeTruthy();
      expect(response.finishReason).toBe('stop');
    });

    it('lists available models from Ollama server /api/tags', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            models: [
              { name: 'llama3.3:8b' },
              { name: 'mistral:latest' },
              { name: 'qwen2.5:14b' },
            ],
          }),
        })
      );

      const provider = new OllamaAiProvider();
      const models = await provider.listModels();
      expect(models).toEqual(['llama3.3:8b', 'mistral:latest', 'qwen2.5:14b']);
    });

    it('generates non-streaming completion from Ollama /api/chat', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.3:latest',
          message: {
            role: 'assistant',
            content: 'Our standard HVAC diagnostics fee is $89.',
          },
          prompt_eval_count: 24,
          eval_count: 12,
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OllamaAiProvider({
        baseURL: 'http://localhost:11434',
        defaultModel: 'llama3.3:latest',
      });

      const response = await provider.generate({
        messages: [{ role: 'user', content: 'How much is an AC diagnostic?' }],
        temperature: 0.2,
        maxTokens: 100,
      });

      expect(response.content).toBe('Our standard HVAC diagnostics fee is $89.');
      expect(response.usage?.promptTokens).toBe(24);
      expect(response.usage?.completionTokens).toBe(12);
      expect(response.usage?.totalTokens).toBe(36);

      // Verify request payload
      const [url, req] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
      const body = JSON.parse(req.body);
      expect(body.model).toBe('llama3.3:latest');
      expect(body.stream).toBe(false);
      expect(body.options.temperature).toBe(0.2);
    });

    it('handles Ollama server errors and throws AiProviderError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'Model not found',
        })
      );

      const provider = new OllamaAiProvider();
      await expect(
        provider.generate({
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow(AiProviderError);
    });
  });

  describe('VllmAiProvider', () => {
    it('initializes with default high-throughput configuration', () => {
      const provider = new VllmAiProvider();
      expect(provider.providerId).toBe('vllm');
      expect(provider.defaultModel).toBe('meta-llama/Llama-3.3-70B-Instruct');
      const caps = provider.getCapabilities();
      expect(caps.maxContextTokens).toBe(131072);
    });

    it('generates completion via OpenAI-compatible vLLM endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Emergency HVAC technicians are available 24/7.',
              },
            },
          ],
          usage: {
            prompt_tokens: 30,
            completion_tokens: 10,
            total_tokens: 40,
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new VllmAiProvider({
        baseURL: 'http://localhost:8000/v1',
      });

      const response = await provider.generate({
        messages: [{ role: 'user', content: 'Do you offer emergency service?' }],
      });

      expect(response.content).toBe('Emergency HVAC technicians are available 24/7.');
      expect(response.usage?.totalTokens).toBe(40);
    });
  });

  describe('AI Provider Factory for Local Models', () => {
    it('instantiates OllamaAiProvider via createAiProvider factory', () => {
      const provider = createAiProvider({
        type: 'ollama',
        model: 'mistral:7b',
      });
      expect(provider).toBeInstanceOf(OllamaAiProvider);
      expect(provider.defaultModel).toBe('mistral:7b');
    });

    it('instantiates VllmAiProvider via createAiProvider factory', () => {
      const provider = createAiProvider({
        type: 'vllm',
        baseURL: 'http://cluster.local:8000/v1',
        model: 'Qwen/Qwen2.5-14B-Instruct',
      });
      expect(provider).toBeInstanceOf(VllmAiProvider);
      expect(provider.defaultModel).toBe('Qwen/Qwen2.5-14B-Instruct');
    });
  });
});
