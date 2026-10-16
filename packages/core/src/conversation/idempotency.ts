export interface IdempotencyRecord {
  eventKey: string;
  processedAt: Date;
  resultPayload?: any;
}

export class IdempotencyManager {
  private cache: Map<string, IdempotencyRecord> = new Map();
  private maxEntries: number;
  private ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000, maxEntries: number = 10000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /**
   * Generates a composite event key from provider/channel and event ID.
   */
  public makeKey(tenantId: string, provider: string, eventId: string): string {
    return `${tenantId}:${provider}:${eventId}`;
  }

  /**
   * Checks if an event has already been recorded and processed.
   */
  public has(eventKey: string): boolean {
    this.cleanExpired();
    return this.cache.has(eventKey);
  }

  /**
   * Gets cached result payload if previously processed.
   */
  public get(eventKey: string): IdempotencyRecord | undefined {
    this.cleanExpired();
    return this.cache.get(eventKey);
  }

  /**
   * Records an event as successfully processed.
   */
  public record(eventKey: string, resultPayload?: any): void {
    if (this.cache.size >= this.maxEntries) {
      // Remove oldest entries
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(eventKey, {
      eventKey,
      processedAt: new Date(),
      resultPayload,
    });
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.cache.entries()) {
      if (now - record.processedAt.getTime() > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  public clear(): void {
    this.cache.clear();
  }
}

export const defaultIdempotencyManager = new IdempotencyManager();
