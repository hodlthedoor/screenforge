import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageLifecycleManager } from '../../src/storage/lifecycle.js';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { incrementStorageReclaimedBytes } from '../../src/metrics/index.js';

vi.mock('../../src/metrics/index.js', () => ({
  incrementStorageReclaimedBytes: vi.fn(),
}));

describe('StorageLifecycleManager', () => {
  let tempDir: string;
  let manager: StorageLifecycleManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lifecycle-test-'));
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    if (manager) {
      manager.stop();
    }
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('schedules cleanup on start with configurable interval', async () => {
    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
      intervalMs: 5000, // 5 seconds for testing
    });

    const cleanupSpy = vi.spyOn(manager, 'runCleanup');

    manager.start();

    // Should not run immediately
    expect(cleanupSpy).not.toHaveBeenCalled();

    // Advance to first interval
    await vi.advanceTimersByTimeAsync(5000);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    // Advance to second interval
    await vi.advanceTimersByTimeAsync(5000);
    expect(cleanupSpy).toHaveBeenCalledTimes(2);
  });

  it('prevents double-start', () => {
    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
    });

    manager.start();
    expect(() => manager.start()).toThrow('already started');
  });

  it('stops interval safely', async () => {
    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
      intervalMs: 1000,
    });

    const cleanupSpy = vi.spyOn(manager, 'runCleanup');
    manager.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    manager.stop();

    // Should not run after stop
    await vi.advanceTimersByTimeAsync(1000);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes files older than retention period', async () => {
    // Create date directories with test files
    const today = new Date();
    const expired1 = new Date(today);
    expired1.setDate(today.getDate() - 10); // 10 days ago (expired)
    const expired2 = new Date(today);
    expired2.setDate(today.getDate() - 8); // 8 days ago (expired)
    const boundary = new Date(today);
    boundary.setDate(today.getDate() - 7); // 7 days ago (boundary - should be kept)
    const recent = new Date(today);
    recent.setDate(today.getDate() - 3); // 3 days ago (recent)

    const expired1Dir = join(tempDir, expired1.toISOString().slice(0, 10));
    const expired2Dir = join(tempDir, expired2.toISOString().slice(0, 10));
    const boundaryDir = join(tempDir, boundary.toISOString().slice(0, 10));
    const recentDir = join(tempDir, recent.toISOString().slice(0, 10));

    await mkdir(expired1Dir, { recursive: true });
    await mkdir(expired2Dir, { recursive: true });
    await mkdir(boundaryDir, { recursive: true });
    await mkdir(recentDir, { recursive: true });

    await writeFile(join(expired1Dir, 'old1.png'), Buffer.alloc(1024)); // 1KB
    await writeFile(join(expired1Dir, 'old2.png'), Buffer.alloc(2048)); // 2KB
    await writeFile(join(expired2Dir, 'old3.png'), Buffer.alloc(512)); // 0.5KB
    await writeFile(join(boundaryDir, 'boundary.png'), Buffer.alloc(1024)); // Should be kept
    await writeFile(join(recentDir, 'recent.png'), Buffer.alloc(1024)); // Should be kept

    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
    });

    await manager.runCleanup();

    // Expired directories should be deleted
    const remaining = await readdir(tempDir);
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain(boundary.toISOString().slice(0, 10));
    expect(remaining).toContain(recent.toISOString().slice(0, 10));

    // Should reclaim 1024 + 2048 + 512 = 3584 bytes
    expect(incrementStorageReclaimedBytes).toHaveBeenCalledWith(3584);
  });

  it('removes empty date directories after cleanup', async () => {
    const today = new Date();
    const old = new Date(today);
    old.setDate(today.getDate() - 10);

    const oldDir = join(tempDir, old.toISOString().slice(0, 10));
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(oldDir, 'file.png'), Buffer.alloc(100));

    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
    });

    await manager.runCleanup();

    // Directory should be completely removed after files are deleted
    const remaining = await readdir(tempDir);
    expect(remaining).toHaveLength(0);
  });

  it('skips non-date directories safely', async () => {
    // Create invalid directories
    await mkdir(join(tempDir, 'invalid-dir'), { recursive: true });
    await mkdir(join(tempDir, '2024-13-45'), { recursive: true }); // Invalid date
    await writeFile(join(tempDir, 'loose-file.txt'), 'test');

    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
    });

    // Should not throw
    await expect(manager.runCleanup()).resolves.not.toThrow();

    // Non-date items should still exist
    const remaining = await readdir(tempDir);
    expect(remaining).toContain('invalid-dir');
    expect(remaining).toContain('2024-13-45');
    expect(remaining).toContain('loose-file.txt');
  });

  it('handles missing storage directory gracefully', async () => {
    const nonExistent = join(tempDir, 'does-not-exist');

    manager = new StorageLifecycleManager({
      storagePath: nonExistent,
      retentionDays: 7,
    });

    // Should not throw
    await expect(manager.runCleanup()).resolves.not.toThrow();

    // Should still track zero bytes (for completeness)
    expect(incrementStorageReclaimedBytes).toHaveBeenCalledWith(0);
  });

  it('continues cleanup despite partial errors', async () => {
    const today = new Date();
    const old1 = new Date(today);
    old1.setDate(today.getDate() - 10);
    const old2 = new Date(today);
    old2.setDate(today.getDate() - 9);

    const old1Dir = join(tempDir, old1.toISOString().slice(0, 10));
    const old2Dir = join(tempDir, old2.toISOString().slice(0, 10));

    await mkdir(old1Dir, { recursive: true });
    await mkdir(old2Dir, { recursive: true });
    await writeFile(join(old1Dir, 'file1.png'), Buffer.alloc(100));
    await writeFile(join(old2Dir, 'file2.png'), Buffer.alloc(200));

    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
    });

    // Should reclaim from both directories despite any partial errors
    await manager.runCleanup();

    expect(incrementStorageReclaimedBytes).toHaveBeenCalledWith(300);
  });

  it('tracks zero reclaimed bytes when nothing to clean', async () => {
    const today = new Date();
    const recent = new Date(today);
    recent.setDate(today.getDate() - 2);

    const recentDir = join(tempDir, recent.toISOString().slice(0, 10));
    await mkdir(recentDir, { recursive: true });
    await writeFile(join(recentDir, 'recent.png'), Buffer.alloc(100));

    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
    });

    await manager.runCleanup();

    // Should report zero bytes reclaimed
    expect(incrementStorageReclaimedBytes).toHaveBeenCalledWith(0);
  });

  it('prevents concurrent cleanup runs', async () => {
    const today = new Date();
    const old = new Date(today);
    old.setDate(today.getDate() - 10);

    const oldDir = join(tempDir, old.toISOString().slice(0, 10));
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(oldDir, 'file.png'), Buffer.alloc(100));

    manager = new StorageLifecycleManager({
      storagePath: tempDir,
      retentionDays: 7,
    });

    // Start two cleanups concurrently
    const promise1 = manager.runCleanup();
    const promise2 = manager.runCleanup();

    await Promise.all([promise1, promise2]);

    // Metric should only be incremented once (100 bytes, not 200)
    expect(incrementStorageReclaimedBytes).toHaveBeenCalledTimes(1);
    expect(incrementStorageReclaimedBytes).toHaveBeenCalledWith(100);
  });
});
