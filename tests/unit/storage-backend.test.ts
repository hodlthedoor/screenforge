import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStorageBackend } from '../../src/storage/local.js';
import { S3StorageBackend } from '../../src/storage/s3.js';
import { createStorageBackend, resetStorageBackend, getStorageBackend } from '../../src/storage/index.js';

// --- Local backend tests ---

describe('LocalStorageBackend', () => {
  let tempDir: string;
  let backend: LocalStorageBackend;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'storage-local-'));
    backend = new LocalStorageBackend(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('has type "local"', () => {
    expect(backend.type).toBe('local');
  });

  it('uploads a buffer and writes to disk', async () => {
    const buf = Buffer.from('hello world');
    const result = await backend.upload('test.png', buf, 'image/png');

    expect(result).toBe('test.png');
    const diskContent = await readFile(join(tempDir, 'test.png'));
    expect(diskContent).toEqual(buf);
  });

  it('creates nested directories on upload', async () => {
    const buf = Buffer.from('pdf content');
    await backend.upload('2024-01-15/abc123.pdf', buf, 'application/pdf');

    const diskContent = await readFile(join(tempDir, '2024-01-15', 'abc123.pdf'));
    expect(diskContent).toEqual(buf);
  });

  it('downloads a file', async () => {
    const buf = Buffer.from('download me');
    await mkdir(join(tempDir, 'sub'), { recursive: true });
    await writeFile(join(tempDir, 'sub', 'file.png'), buf);

    const result = await backend.download('sub/file.png');
    expect(result).toEqual(buf);
  });

  it('deletes a file', async () => {
    const buf = Buffer.from('delete me');
    await writeFile(join(tempDir, 'doomed.png'), buf);

    await backend.delete('doomed.png');
    const entries = await readdir(tempDir);
    expect(entries).not.toContain('doomed.png');
  });

  it('checks existence (true)', async () => {
    await writeFile(join(tempDir, 'exists.png'), Buffer.from('x'));
    expect(await backend.exists('exists.png')).toBe(true);
  });

  it('checks existence (false)', async () => {
    expect(await backend.exists('nope.png')).toBe(false);
  });

  it('getUrl returns null', () => {
    expect(backend.getUrl('anything')).toBeNull();
  });
});

// --- S3 backend tests (mocked) ---

const sendMock = vi.fn();
const uploadDoneMock = vi.fn().mockResolvedValue({});

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  class MockS3Client {
    send = sendMock;
  }
  return {
    ...actual,
    S3Client: MockS3Client,
  };
});

vi.mock('@aws-sdk/lib-storage', () => {
  class MockUpload {
    params: unknown;
    constructor(opts: { params: unknown }) {
      MockUpload.lastParams = opts.params;
      this.params = opts.params;
    }
    done = uploadDoneMock;
    static lastParams: unknown;
  }
  return { Upload: MockUpload };
});

describe('S3StorageBackend', () => {
  let backend: S3StorageBackend;

  beforeEach(async () => {
    sendMock.mockReset();
    uploadDoneMock.mockReset().mockResolvedValue({});
    backend = new S3StorageBackend({
      bucket: 'test-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET',
    });
  });

  it('has type "s3"', () => {
    expect(backend.type).toBe('s3');
  });

  it('uploads small buffer with PutObjectCommand', async () => {
    sendMock.mockResolvedValueOnce({});
    const buf = Buffer.alloc(1024); // 1KB — well under threshold

    const result = await backend.upload('renders/abc.png', buf, 'image/png');

    expect(result).toBe('renders/abc.png');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input).toEqual({
      Bucket: 'test-bucket',
      Key: 'renders/abc.png',
      Body: buf,
      ContentType: 'image/png',
    });
  });

  it('uploads large buffer with multipart Upload', async () => {
    const buf = Buffer.alloc(6 * 1024 * 1024); // 6MB — exceeds threshold

    const result = await backend.upload('renders/big.pdf', buf, 'application/pdf');

    expect(result).toBe('renders/big.pdf');
    expect(uploadDoneMock).toHaveBeenCalledTimes(1);
    // sendMock should NOT have been called (multipart uses Upload, not PutObjectCommand)
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('downloads a file and returns buffer', async () => {
    const chunks = [Buffer.from('chunk1'), Buffer.from('chunk2')];
    async function* streamChunks() {
      for (const c of chunks) yield c;
    }
    sendMock.mockResolvedValueOnce({ Body: streamChunks() });

    const result = await backend.download('renders/abc.png');

    expect(result).toEqual(Buffer.concat(chunks));
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input).toEqual({ Bucket: 'test-bucket', Key: 'renders/abc.png' });
  });

  it('throws on empty response body', async () => {
    sendMock.mockResolvedValueOnce({ Body: undefined });

    await expect(backend.download('missing')).rejects.toThrow('Empty response body');
  });

  it('deletes a file', async () => {
    sendMock.mockResolvedValueOnce({});
    await backend.delete('renders/old.png');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input).toEqual({ Bucket: 'test-bucket', Key: 'renders/old.png' });
  });

  it('exists returns true when HeadObject succeeds', async () => {
    sendMock.mockResolvedValueOnce({});
    expect(await backend.exists('renders/abc.png')).toBe(true);
  });

  it('exists returns false for NotFound', async () => {
    const err = new Error('not found');
    (err as unknown as { name: string }).name = 'NotFound';
    sendMock.mockRejectedValueOnce(err);
    expect(await backend.exists('renders/nope.png')).toBe(false);
  });

  it('exists rethrows unexpected errors', async () => {
    sendMock.mockRejectedValueOnce(new Error('network failure'));
    await expect(backend.exists('renders/err.png')).rejects.toThrow('network failure');
  });

  it('getUrl returns AWS-style URL', () => {
    expect(backend.getUrl('renders/abc.png')).toBe(
      'https://test-bucket.s3.us-east-1.amazonaws.com/renders/abc.png',
    );
  });

  it('getUrl returns custom endpoint URL', () => {
    const customBackend = new S3StorageBackend({
      bucket: 'my-bucket',
      region: 'auto',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      endpoint: 'https://minio.local:9000',
    });
    expect(customBackend.getUrl('file.png')).toBe(
      'https://minio.local:9000/my-bucket/file.png',
    );
  });
});

// --- Factory tests ---

describe('createStorageBackend factory', () => {
  beforeEach(() => {
    resetStorageBackend();
  });

  it('creates local backend by default', async () => {
    // loadConfig must be called before getConfig works
    const { loadConfig } = await import('../../src/config/index.js');
    loadConfig({
      API_KEY_SALT: 'testsalt1234567890',
      STORAGE_PATH: '/tmp/test-storage',
      NODE_ENV: 'test',
    });

    const backend = createStorageBackend();
    expect(backend.type).toBe('local');
  });

  it('creates S3 backend when STORAGE_BACKEND=s3', async () => {
    const { loadConfig } = await import('../../src/config/index.js');
    loadConfig({
      API_KEY_SALT: 'testsalt1234567890',
      STORAGE_PATH: '/tmp/test-storage',
      STORAGE_BACKEND: 's3',
      S3_BUCKET: 'my-bucket',
      S3_REGION: 'us-west-2',
      S3_ACCESS_KEY_ID: 'AKID',
      S3_SECRET_ACCESS_KEY: 'SECRET',
      NODE_ENV: 'test',
    });

    const backend = createStorageBackend();
    expect(backend.type).toBe('s3');
  });

  it('throws when S3 config is incomplete', async () => {
    const { loadConfig } = await import('../../src/config/index.js');
    loadConfig({
      API_KEY_SALT: 'testsalt1234567890',
      STORAGE_PATH: '/tmp/test-storage',
      STORAGE_BACKEND: 's3',
      S3_BUCKET: 'my-bucket',
      // Missing region, access key, secret
      NODE_ENV: 'test',
    });

    expect(() => createStorageBackend()).toThrow('S3 storage backend requires');
  });

  it('getStorageBackend returns singleton', async () => {
    const { loadConfig } = await import('../../src/config/index.js');
    loadConfig({
      API_KEY_SALT: 'testsalt1234567890',
      STORAGE_PATH: '/tmp/test-storage',
      NODE_ENV: 'test',
    });

    const a = getStorageBackend();
    const b = getStorageBackend();
    expect(a).toBe(b);
  });
});
