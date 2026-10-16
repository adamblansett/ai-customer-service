import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAiProvider,
  MockAiProvider,
  OpenAiCompatibleProvider,
  AiRateLimitError,
  AiTimeoutError,
  AiAuthError,
} from '../ai/index.js';

describe('AI Provider Abstraction Subsystem', () => {
  describe('Provider Factory & Capabilities', () => {
    it('creates mock provider with default capabilities', () => {
      const provider = createAiProvider({ type: 'mock' });
      expect(provider.providerId).toBe('mock');

      const capabilities = provider.getCapabilities();
      expect(capabilities.supportsTools).toBe(true);
      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.maxContextTokens).toBeGreaterThan(1000);
    });

    it('requires API key for external providers', () => {
      expect(() => createAiProvider({ type: 'openai' })).toThrow(/ApiKeyRequired/);
      expect(() => createAiProvider({ type: 'anthropic' })).toThrow(/ApiKeyRequired/);
      expect(() => createAiProvider({ type: 'gemini' })).toThrow(/ApiKeyRequired/);
    });
  });

  describe('Mock Provider (Offline Deterministic Testing)', () => {
    it('generates predictable responses based on prompt keywords', async () => {
      const provider = new MockAiProvider();

      const hoursResponse = await provider.generate({
        messages: [{ role: 'user', content: 'What are your business hours?' }],
      });
      expect(hoursResponse.content).toContain('8:00 AM to 6:00 PM');
      expect(hoursResponse.usage.totalTokens).toBeGreaterThan(0);
      expect(hoursResponse.finishReason).toBe('stop');

      const agentResponse = await provider.generate({
        messages: [{ role: 'user', content: 'I need to speak to a human representative.' }],
      });
      expect(agentResponse.content).toContain('transfer you to a human');
    });

    it('simulates tool call requests', async () => {
      const provider = new MockAiProvider({
        simulatedToolCall: {
          name: 'lookup_knowledge_base',
          arguments: { query: 'AC repair diagnostic fee' },
        },
      });

      const response = await provider.generate({
        messages: [{ role: 'user', content: 'How much does AC diagnosis cost?' }],
      });

      expect(response.finishReason).toBe('tool_calls');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0].name).toBe('lookup_knowledge_base');
      expect(response.toolCalls[0].arguments.query).toBe('AC repair diagnostic fee');
    });

    it('streams response chunks incrementally', async () => {
      const provider = new MockAiProvider({ cannedResponse: 'Hello world customer service' });
      const chunks: string[] = [];

      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        if (chunk.textDelta) {
          chunks.push(chunk.textDelta);
        }
      }

      expect(chunks.join('')).toContain('Hello world customer service');
    });

    it('simulates error conditions for resilience testing', async () => {
      const rateLimitProvider = new MockAiProvider({ forcedError: 'rate_limit' });
      await expect(
        rateLimitProvider.generate({ messages: [{ role: 'user', content: 'test' }] })
      ).rejects.toThrow(AiRateLimitError);

      const timeoutProvider = new MockAiProvider({ forcedError: 'timeout' });
      await expect(
        timeoutProvider.generate({ messages: [{ role: 'user', content: 'test' }] })
      ).rejects.toThrow(AiTimeoutError);

      const authProvider = new MockAiProvider({ forcedError: 'auth_error' });
      await expect(
        authProvider.generate({ messages: [{ role: 'user', content: 'test' }] })
      ).rejects.toThrow(AiAuthError);
    });
  });

  describe('OpenAI Compatible Provider (Mock HTTP Fixtures)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('normalizes chat completion request and response correctly', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-test-123',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Our diagnostic fee is $89.',
                tool_calls: [
                  {
                    id: 'call_abc123',
                    type: 'function',
                    function: {
                      name: 'create_callback_ticket',
                      arguments: '{"phoneNumber": "+15550101"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 35, completion_tokens: 20, total_tokens: 55 },
        }),
      });

      globalThis.fetch = mockFetch;

      const provider = new OpenAiCompatibleProvider({
        apiKey: 'test-fake-key-123',
        baseURL: 'https://api.openai.com/v1',
      });

      const response = await provider.generate({
        messages: [
          { role: 'system', content: 'You are an HVAC assistant.' },
          { role: 'user', content: 'I need an appointment.' },
        ],
        tools: [
          {
            name: 'create_callback_ticket',
            description: 'Creates a callback ticket',
            parameters: {
              type: 'object',
              properties: { phoneNumber: { type: 'string' } },
            },
          },
        ],
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.openai.com/v1/chat/completions');
      expect(callArgs[1].headers.Authorization).toBe('Bearer test-fake-key-123');

      expect(response.content).toBe('Our diagnostic fee is $89.');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0].name).toBe('create_callback_ticket');
      expect(response.toolCalls[0].arguments).toEqual({ phoneNumber: '+15550101' });
      expect(response.usage.totalTokens).toBe(55);
    });

    it('classifies HTTP 429 as AiRateLimitError with retry-after header', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '15' }),
        text: async () => 'Rate limit exceeded: quota exceeded for current tier',
      });

      const provider = new OpenAiCompatibleProvider({
        apiKey: 'fake-key',
      });

      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'test' }] })
      ).rejects.toThrow(AiRateLimitError);
    });

    it('classifies HTTP 401 as AiAuthError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'Incorrect API key provided',
      });

      const provider = new OpenAiCompatibleProvider({
        apiKey: 'fake-invalid-key',
      });

      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'test' }] })
      ).rejects.toThrow(AiAuthError);
    });
  });
});
