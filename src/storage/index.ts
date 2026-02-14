import { getConfig } from '../config/index.js';
import type { StorageBackend } from './backend.js';
import { LocalStorageBackend } from './local.js';
import { S3StorageBackend } from './s3.js';

export type { StorageBackend } from './backend.js';
export { LocalStorageBackend } from './local.js';
export { S3StorageBackend } from './s3.js';
export { StorageLifecycleManager } from './lifecycle.js';

let _instance: StorageBackend | undefined;

export function createStorageBackend(): StorageBackend {
  const config = getConfig();
  const backend = config.STORAGE_BACKEND;

  if (backend === 's3') {
    const { S3_BUCKET: bucket, S3_REGION: region, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey, S3_ENDPOINT: endpoint } = config;

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'S3 storage backend requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY',
      );
    }

    return new S3StorageBackend({
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      endpoint: endpoint || undefined,
    });
  }

  return new LocalStorageBackend(config.STORAGE_PATH);
}

export function getStorageBackend(): StorageBackend {
  if (!_instance) {
    _instance = createStorageBackend();
  }
  return _instance;
}

/** Reset singleton (for testing). */
export function resetStorageBackend(): void {
  _instance = undefined;
}
