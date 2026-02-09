import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Redis } from 'ioredis';

export interface CacheEntry {
  filePath: string;
  contentType: string;
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
    const sorted = JSON.stringify(options, Object.keys(options).sort());
    return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
  }

  async get(optionsHash: string): Promise<CacheEntry | null> {
    const raw = await this.redis.get(`screenforge:cache:${optionsHash}`);
    if (!raw) return null;

    const entry: CacheEntry = JSON.parse(raw);

    try {
      await access(entry.filePath);
      return entry;
    } catch {
      await this.redis.del(`screenforge:cache:${optionsHash}`);
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

    return entry;
  }

  async readFile(filePath: string): Promise<Buffer> {
    return readFile(filePath);
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
