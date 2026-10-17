export interface IdempotencyRecord {
  eventKey: string;
  processedAt: Date;
  resultPayload?: any;
}

export interface IdempotencyStorage {
  get(key: string): Promise<IdempotencyRecord | undefined> | IdempotencyRecord | undefined;
  set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> | void;
  has(key: string): Promise<boolean> | boolean;
  clear?(): Promise<void> | void;
}

export class MemoryIdempotencyStorage implements IdempotencyStorage {
  private cache: Map<string, IdempotencyRecord> = new Map();
  private maxEntries: number;
  private ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000, maxEntries: number = 10000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  public get(key: string): IdempotencyRecord | undefined {
    this.cleanExpired();
    return this.cache.get(key);
  }

  public set(key: string, record: IdempotencyRecord, _ttlMs: number): void {
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, record);
  }

  public has(key: string): boolean {
    this.cleanExpired();
    return this.cache.has(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.cache.entries()) {
      if (now - record.processedAt.getTime() > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Minimal interface compatible with Redis and ioredis clients.
 */
export interface RedisCompatibleClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<any>;
  exists(key: string): Promise<number | boolean>;
  del(key: string): Promise<number>;
}

export class RedisIdempotencyStorage implements IdempotencyStorage {
  private redis: RedisCompatibleClient;
  private keyPrefix: string;
  private defaultTtlMs: number;

  constructor(
    redis: RedisCompatibleClient,
    options?: { keyPrefix?: string; defaultTtlMs?: number }
  ) {
    this.redis = redis;
    this.keyPrefix = options?.keyPrefix || 'idempotency:';
    this.defaultTtlMs = options?.defaultTtlMs || 24 * 60 * 60 * 1000;
  }

  private prefix(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  public async get(key: string): Promise<IdempotencyRecord | undefined> {
    const raw = await this.redis.get(this.prefix(key));
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return {
        eventKey: parsed.eventKey,
        processedAt: new Date(parsed.processedAt),
        resultPayload: parsed.resultPayload,
      };
    } catch {
      return undefined;
    }
  }

  public async set(key: string, record: IdempotencyRecord, ttlMs?: number): Promise<void> {
    const ttl = ttlMs || this.defaultTtlMs;
    const serialized = JSON.stringify({
      eventKey: record.eventKey,
      processedAt: record.processedAt.toISOString(),
      resultPayload: record.resultPayload,
    });
    // Set with PX (millisecond TTL)
    await this.redis.set(this.prefix(key), serialized, 'PX', ttl);
  }

  public async has(key: string): Promise<boolean> {
    const res = await this.redis.exists(this.prefix(key));
    return typeof res === 'boolean' ? res : res > 0;
  }

  public async clear(): Promise<void> {
    // Clear is an intentional no-op on Redis shared clusters to prevent accidental global FLUSHDB
  }
}

export interface IdempotencyManagerOptions {
  storage?: IdempotencyStorage;
  ttlMs?: number;
  maxEntries?: number;
}

export class IdempotencyManager {
  private storage: IdempotencyStorage;
  private ttlMs: number;

  constructor(
    ttlOrOptions: number | IdempotencyManagerOptions = 24 * 60 * 60 * 1000,
    maxEntries: number = 10000
  ) {
    if (typeof ttlOrOptions === 'object') {
      this.ttlMs = ttlOrOptions.ttlMs || 24 * 60 * 60 * 1000;
      this.storage =
        ttlOrOptions.storage ||
        new MemoryIdempotencyStorage(this.ttlMs, ttlOrOptions.maxEntries || maxEntries);
    } else {
      this.ttlMs = ttlOrOptions;
      this.storage = new MemoryIdempotencyStorage(this.ttlMs, maxEntries);
    }
  }

  /**
   * Generates a composite event key from tenant, provider, and event ID.
   */
  public makeKey(tenantId: string, provider: string, eventId: string): string {
    return `${tenantId}:${provider}:${eventId}`;
  }

  /**
   * Synchronous check (supported for Memory storage).
   */
  public has(eventKey: string): boolean {
    const result = this.storage.has(eventKey);
    if (typeof result === 'boolean') {
      return result;
    }
    throw new Error(
      'Synchronous has() called on an asynchronous storage adapter. Use hasAsync() instead.'
    );
  }

  /**
   * Asynchronous check (supports both Memory and Redis storage).
   */
  public async hasAsync(eventKey: string): Promise<boolean> {
    const result = await this.storage.has(eventKey);
    return Boolean(result);
  }

  /**
   * Synchronous get (supported for Memory storage).
   */
  public get(eventKey: string): IdempotencyRecord | undefined {
    const result = this.storage.get(eventKey);
    if (result && typeof (result as any).then === 'function') {
      throw new Error(
        'Synchronous get() called on an asynchronous storage adapter. Use getAsync() instead.'
      );
    }
    return result as IdempotencyRecord | undefined;
  }

  /**
   * Asynchronous get (supports both Memory and Redis storage).
   */
  public async getAsync(eventKey: string): Promise<IdempotencyRecord | undefined> {
    return await this.storage.get(eventKey);
  }

  /**
   * Synchronous record (supported for Memory storage).
   */
  public record(eventKey: string, resultPayload?: any): void {
    const record: IdempotencyRecord = {
      eventKey,
      processedAt: new Date(),
      resultPayload,
    };
    const result = this.storage.set(eventKey, record, this.ttlMs);
    if (result && typeof (result as any).then === 'function') {
      throw new Error(
        'Synchronous record() called on an asynchronous storage adapter. Use recordAsync() instead.'
      );
    }
  }

  /**
   * Asynchronous record (supports both Memory and Redis storage).
   */
  public async recordAsync(eventKey: string, resultPayload?: any): Promise<void> {
    const record: IdempotencyRecord = {
      eventKey,
      processedAt: new Date(),
      resultPayload,
    };
    await this.storage.set(eventKey, record, this.ttlMs);
  }

  public clear(): void {
    if (this.storage.clear) {
      this.storage.clear();
    }
  }

  public async clearAsync(): Promise<void> {
    if (this.storage.clear) {
      await this.storage.clear();
    }
  }
}

export const defaultIdempotencyManager = new IdempotencyManager();
