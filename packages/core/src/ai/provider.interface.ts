import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiStreamChunk,
  ModelCapabilities,
} from './types.js';

export interface AiProvider {
  readonly providerId: string;
  readonly defaultModel: string;

  getCapabilities(model?: string): ModelCapabilities;

  generate(request: AiGenerateRequest): Promise<AiGenerateResponse>;

  stream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk>;
}
