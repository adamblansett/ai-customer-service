import { AiProvider } from './provider.interface.js';
import { MockAiProvider, MockProviderOptions } from './mock-provider.js';
import { OpenAiCompatibleProvider, OpenAiCompatibleConfig } from './openai-compatible.js';
import { AnthropicProvider, AnthropicConfig } from './anthropic-provider.js';
import { GeminiProvider, GeminiConfig } from './gemini-provider.js';

export type ProviderType = 'openai' | 'groq' | 'anthropic' | 'gemini' | 'mock';

export interface ProviderFactoryOptions {
  type: ProviderType;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  mockOptions?: MockProviderOptions;
}

export function createAiProvider(options: ProviderFactoryOptions): AiProvider {
  switch (options.type) {
    case 'mock':
      return new MockAiProvider(options.mockOptions);

    case 'openai':
    case 'groq':
      if (!options.apiKey) {
        throw new Error(`ApiKeyRequired: Missing API key for provider '${options.type}'.`);
      }
      return new OpenAiCompatibleProvider({
        apiKey: options.apiKey || '',
        baseURL: options.baseURL,
        defaultModel: options.model,
        providerId: options.type,
      });

    case 'anthropic':
      if (!options.apiKey) {
        throw new Error("ApiKeyRequired: Missing API key for provider 'anthropic'.");
      }
      return new AnthropicProvider({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        defaultModel: options.model,
      });

    case 'gemini':
      if (!options.apiKey) {
        throw new Error("ApiKeyRequired: Missing API key for provider 'gemini'.");
      }
      return new GeminiProvider({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        defaultModel: options.model,
      });

    default:
      throw new Error(`UnsupportedProvider: Unknown AI provider type '${options.type}'.`);
  }
}
