import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { updateCacheGauges } from '../metrics/index.js';

export interface CacheEntry {
  filePath: string;
  contentType: string;
}

export class RenderCache {
  private redis: Redis;
  private storagePath: string;
  private ttlSeconds: number;
  private cachedSizeBytes = 0;

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
      await this.updateMetrics();
      return null;
    }

    const entry: CacheEntry = JSON.parse(raw);

    try {
      await access(entry.filePath);
      await this.updateMetrics();
      return entry;
    } catch {
      await this.redis.del(`screenforge:cache:${optionsHash}`);
      await this.updateMetrics();
      return null;
    }
  }

  async set(optionsHash: string, buffer: Buffer, contentType: string, ext: string): Promise<CacheEntry> {
    const date = new Date().toISOString().slice(0, 10);
    const dir = join(this.storagePath, date);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, `${optionsHash}.${ext}`);
    await writeFile(filePath, buffer);

    const entry: CacheEntry = { filePath, contentType };
    await this.redis.set(`screenforge:cache:${optionsHash}`, JSON.stringify(entry), 'EX', this.ttlSeconds);

    this.cachedSizeBytes += buffer.length;
    await this.updateMetrics();

    return entry;
  }

  async readFile(filePath: string): Promise<Buffer> {
    return readFile(filePath);
  }

  private async updateMetrics(): Promise<void> {
    try {
      const keys = await this.redis.keys('screenforge:cache:*');
      updateCacheGauges(keys.length, this.cachedSizeBytes);
    } catch {
      // Ignore errors updating metrics
    }
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
