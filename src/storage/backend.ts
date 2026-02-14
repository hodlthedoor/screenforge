export interface StorageBackend {
  /** Upload a buffer and return the storage key (or path). */
  upload(key: string, buffer: Buffer, contentType: string): Promise<string>;

  /** Download a file by key, returning its contents. */
  download(key: string): Promise<Buffer>;

  /** Delete a file by key. */
  delete(key: string): Promise<void>;

  /** Check if a file exists. */
  exists(key: string): Promise<boolean>;

  /**
   * Get a public URL for the key, or null if the backend doesn't support URLs.
   * Local backend returns null; S3 returns a constructed URL.
   */
  getUrl(key: string): string | null;

  /** Backend type identifier. */
  readonly type: 'local' | 's3';
}
