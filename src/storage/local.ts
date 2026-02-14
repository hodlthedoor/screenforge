import { mkdir, writeFile, readFile, access, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { StorageBackend } from './backend.js';

export class LocalStorageBackend implements StorageBackend {
  readonly type = 'local' as const;
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private resolvePath(key: string): string {
    return join(this.basePath, key);
  }

  async upload(key: string, buffer: Buffer, _contentType: string): Promise<string> {
    const filePath = this.resolvePath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolvePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  getUrl(_key: string): string | null {
    return null;
  }
}
