import { readdir, stat, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { incrementStorageReclaimedBytes } from '../metrics/index.js';

export interface StorageLifecycleOptions {
  storagePath: string;
  retentionDays: number;
  intervalMs?: number;
  logger?: FastifyBaseLogger;
}

export class StorageLifecycleManager {
  private storagePath: string;
  private retentionDays: number;
  private intervalMs: number;
  private logger?: FastifyBaseLogger;
  private intervalHandle?: ReturnType<typeof setInterval>;
  private isRunning = false;

  constructor(options: StorageLifecycleOptions) {
    this.storagePath = options.storagePath;
    this.retentionDays = options.retentionDays;
    this.intervalMs = options.intervalMs ?? 60 * 60 * 1000; // 1 hour default
    this.logger = options.logger;
  }

  start(): void {
    if (this.intervalHandle) {
      throw new Error('StorageLifecycleManager already started');
    }

    this.intervalHandle = setInterval(() => {
      void this.runCleanup();
    }, this.intervalMs);

    this.logger?.info(
      { intervalMs: this.intervalMs, retentionDays: this.retentionDays },
      'Storage lifecycle manager started'
    );
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
      this.logger?.info('Storage lifecycle manager stopped');
    }
  }

  async runCleanup(): Promise<void> {
    // Prevent concurrent runs
    if (this.isRunning) {
      this.logger?.debug('Cleanup already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      let totalBytesReclaimed = 0;
      let filesDeleted = 0;
      let dirsDeleted = 0;
      let errors = 0;

      // Check if storage directory exists
      try {
        await stat(this.storagePath);
      } catch {
        this.logger?.warn({ storagePath: this.storagePath }, 'Storage path does not exist, skipping cleanup');
        incrementStorageReclaimedBytes(0);
        return;
      }

      // Calculate cutoff date (files older than this should be deleted)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      const cutoffDateStr = cutoffDate.toISOString().slice(0, 10);

      // Scan storage directory for date-formatted directories
      const entries = await readdir(this.storagePath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue; // Skip non-directories (loose files)
        }

        const dirName = entry.name;

        // Validate YYYY-MM-DD format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dirName)) {
          continue; // Skip non-date directories
        }

        // Parse date and check if it's a valid date
        const dirDate = new Date(dirName);
        if (isNaN(dirDate.getTime())) {
          continue; // Skip invalid dates like 2024-13-45
        }

        // Skip if directory is within retention period
        if (dirName >= cutoffDateStr) {
          continue;
        }

        // Directory is expired - delete all files in it
        const dirPath = join(this.storagePath, dirName);

        try {
          const files = await readdir(dirPath);

          for (const file of files) {
            const filePath = join(dirPath, file);

            try {
              const fileStat = await stat(filePath);
              await unlink(filePath);
              totalBytesReclaimed += fileStat.size;
              filesDeleted++;
            } catch (err) {
              errors++;
              this.logger?.error({ filePath, error: err }, 'Failed to delete file');
            }
          }

          // Remove empty directory
          try {
            await rmdir(dirPath);
            dirsDeleted++;
          } catch (err) {
            errors++;
            this.logger?.error({ dirPath, error: err }, 'Failed to remove directory');
          }
        } catch (err) {
          errors++;
          this.logger?.error({ dirPath, error: err }, 'Failed to scan directory');
        }
      }

      // Emit metrics
      incrementStorageReclaimedBytes(totalBytesReclaimed);

      // Log cleanup stats
      const durationMs = Date.now() - startTime;
      this.logger?.info(
        {
          bytesReclaimed: totalBytesReclaimed,
          filesDeleted,
          dirsDeleted,
          errors,
          durationMs,
          retentionDays: this.retentionDays,
        },
        'Storage cleanup completed'
      );
    } finally {
      this.isRunning = false;
    }
  }
}
