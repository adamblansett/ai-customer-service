import { AiProvider } from './provider.interface.js';
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiStreamChunk,
  ModelCapabilities,
  AiRateLimitError,
  AiTimeoutError,
  AiAuthError,
} from './types.js';

export interface MockProviderOptions {
  simulatedLatencyMs?: number;
  forcedError?: 'rate_limit' | 'timeout' | 'auth_error' | null;
  cannedResponse?: string;
  simulatedToolCall?: { name: string; arguments: Record<string, any> };
}

export class MockAiProvider implements AiProvider {
  public readonly providerId = 'mock';
  public readonly defaultModel = 'mock-v1';

  constructor(private options: MockProviderOptions = {}) {}

  getCapabilities(_model?: string): ModelCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 128000,
    };
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (this.options.forcedError === 'rate_limit') {
      throw new AiRateLimitError(this.providerId, 5);
    }
    if (this.options.forcedError === 'timeout') {
      throw new AiTimeoutError(this.providerId);
    }
    if (this.options.forcedError === 'auth_error') {
      throw new AiAuthError(this.providerId);
    }

    if (this.options.simulatedLatencyMs) {
      await new Promise(r => setTimeout(r, this.options.simulatedLatencyMs));
    }

    if (request.abortSignal?.aborted) {
      throw new Error('AbortError: Request was cancelled by caller.');
    }

    if (this.options.simulatedToolCall) {
      return {
        content: '',
        toolCalls: [
          {
            id: 'mock_call_1',
            name: this.options.simulatedToolCall.name,
            arguments: this.options.simulatedToolCall.arguments,
          },
        ],
        usage: { promptTokens: 40, completionTokens: 15, totalTokens: 55 },
        finishReason: 'tool_calls',
      };
    }

    const lastMessage = request.messages[request.messages.length - 1]?.content || '';
    let responseText = this.options.cannedResponse;

    if (!responseText) {
      if (lastMessage.toLowerCase().includes('hours')) {
        responseText = 'Our business hours are Monday through Friday from 8:00 AM to 6:00 PM Eastern, and Saturday from 9:00 AM to 2:00 PM.';
      } else if (lastMessage.toLowerCase().includes('human') || lastMessage.toLowerCase().includes('agent')) {
        responseText = 'I will transfer you to a human representative right away.';
      } else {
        responseText = 'Thank you for your inquiry. How else can I assist you with your customer service request today?';
      }
    }

    return {
      content: responseText,
      toolCalls: [],
      usage: {
        promptTokens: 50,
        completionTokens: responseText.split(' ').length * 2,
        totalTokens: 50 + responseText.split(' ').length * 2,
      },
      finishReason: 'stop',
    };
  }

  async *stream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    const full = await this.generate(request);

    if (full.toolCalls.length > 0) {
      yield {
        toolCallDelta: full.toolCalls[0],
        isFinished: false,
      };
      yield { isFinished: true };
      return;
    }

    const words = full.content.split(' ');
    for (const word of words) {
      yield {
        textDelta: word + ' ',
        isFinished: false,
      };
    }
    yield { isFinished: true };
  }
}
