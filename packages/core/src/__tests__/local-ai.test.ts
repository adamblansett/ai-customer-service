import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OllamaAiProvider,
  VllmAiProvider,
  createAiProvider,
  AiProviderError,
} from '../ai/index.js';

describe('Local & Air-Gapped AI Model Adapters (Ollama & vLLM)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('OllamaAiProvider', () => {
    it('reports correct model capabilities', () => {
      const provider = new OllamaAiProvider();
      const caps = provider.getCapabilities();
      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.maxContextTokens).toBe(128000);
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
