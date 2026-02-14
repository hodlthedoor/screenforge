import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageBackend } from './backend.js';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint for MinIO / Cloudflare R2 / other S3-compatible providers. */
  endpoint?: string;
}

/** Threshold for multipart upload (5 MB). */
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

export class S3StorageBackend implements StorageBackend {
  readonly type = 's3' as const;
  private client: S3Client;
  private bucket: string;
  private endpoint?: string;
  private region: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.endpoint = config.endpoint;
    this.region = config.region;

    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    });
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    if (buffer.length > MULTIPART_THRESHOLD) {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        },
      });
      await upload.done();
    } else {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
    }
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const stream = response.Body;
    if (!stream) {
      throw new Error(`Empty response body for key: ${key}`);
    }
    // @aws-sdk returns a Readable or a web ReadableStream
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code === 'NotFound' || code === 'NoSuchKey') {
        return false;
      }
      throw err;
    }
  }

  getUrl(key: string): string | null {
    if (this.endpoint) {
      return `${this.endpoint}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
