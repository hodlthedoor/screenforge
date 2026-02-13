import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { updateCacheGauges } from '../metrics/index.js';

// Redis keys for atomic cache counters (avoids KEYS scan)
const CACHE_COUNT_KEY = 'screenforge:cache:_count';
const CACHE_SIZE_KEY = 'screenforge:cache:_size';

export interface CacheEntry {
  filePath: string;
  contentType: string;
  sizeBytes: number;
}

export class RenderCache {
  private redis: Redis;
  private storagePath: string;
  private ttlSeconds: number;

  constructor(redisUrl: string, storagePath: string, ttlSeconds: number) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
    this.storagePath = storagePath;
    this.ttlSeconds = ttlSeconds;
  }

  static hashOptions(options: Record<string, unknown>): string {
    const sortDeep = (obj: unknown): unknown => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(sortDeep);
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
        sorted[key] = sortDeep((obj as Record<string, unknown>)[key]);
      }
      return sorted;
    };
    return createHash('sha256').update(JSON.stringify(sortDeep(options))).digest('hex').slice(0, 16);
  }

  async get(optionsHash: string): Promise<CacheEntry | null> {
    const raw = await this.redis.get(`screenforge:cache:${optionsHash}`);
    if (!raw) {
      await this.emitMetrics();
      return null;
    }

    const entry: CacheEntry = JSON.parse(raw);

    try {
      await access(entry.filePath);
      await this.emitMetrics();
      return entry;
    } catch {
      // File missing on disk — evict from Redis and adjust counters
      await this.redis.del(`screenforge:cache:${optionsHash}`);
      await this.redis.decr(CACHE_COUNT_KEY);
      await this.redis.decrby(CACHE_SIZE_KEY, entry.sizeBytes);
      await this.emitMetrics();
      return null;
    }
  }

  async set(optionsHash: string, buffer: Buffer, contentType: string, ext: string): Promise<CacheEntry> {
    const date = new Date().toISOString().slice(0, 10);
    const dir = join(this.storagePath, date);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, `${optionsHash}.${ext}`);
    await writeFile(filePath, buffer);

    const entry: CacheEntry = { filePath, contentType, sizeBytes: buffer.length };
    await this.redis.set(`screenforge:cache:${optionsHash}`, JSON.stringify(entry), 'EX', this.ttlSeconds);

    // Increment atomic counters
    await this.redis.incr(CACHE_COUNT_KEY);
    await this.redis.incrby(CACHE_SIZE_KEY, buffer.length);
    await this.emitMetrics();

    return entry;
  }

  async readFile(filePath: string): Promise<Buffer> {
    return readFile(filePath);
  }

  private async emitMetrics(): Promise<void> {
    try {
      const [countStr, sizeStr] = await Promise.all([
        this.redis.get(CACHE_COUNT_KEY),
        this.redis.get(CACHE_SIZE_KEY),
      ]);
      const count = Math.max(0, parseInt(countStr ?? '0', 10));
      const size = Math.max(0, parseInt(sizeStr ?? '0', 10));
      updateCacheGauges(count, size);
    } catch {
      // Ignore errors updating metrics
    }
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
