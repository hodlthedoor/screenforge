import { getPool } from './index.js';

export interface Baseline {
  id: string;
  apiKeyId: string;
  name: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

export async function createBaseline(
  apiKeyId: string,
  name: string,
  storagePath: string,
  width: number | null,
  height: number | null,
): Promise<Baseline> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock existing rows for this API key to prevent concurrent inserts racing past the limit
    const existingRows = await client.query(
      'SELECT name FROM diff_baselines WHERE api_key_id = $1 FOR UPDATE',
      [apiKeyId],
    );

    const isUpdate = existingRows.rows.some((r) => r.name === name);

    if (!isUpdate && existingRows.rows.length >= 50) {
      await client.query('ROLLBACK');
      throw new BaselineLimitError();
    }

    const result = await client.query(
      `INSERT INTO diff_baselines (api_key_id, name, storage_path, width, height)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (api_key_id, name) DO UPDATE
         SET storage_path = EXCLUDED.storage_path,
             width = EXCLUDED.width,
             height = EXCLUDED.height,
             created_at = NOW()
       RETURNING id, api_key_id, name, storage_path, width, height, created_at`,
      [apiKeyId, name, storagePath, width, height],
    );

    await client.query('COMMIT');
    return mapRow(result.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getBaseline(apiKeyId: string, name: string): Promise<Baseline | null> {
  const result = await getPool().query(
    `SELECT id, api_key_id, name, storage_path, width, height, created_at
     FROM diff_baselines WHERE api_key_id = $1 AND name = $2`,
    [apiKeyId, name],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function deleteBaseline(apiKeyId: string, name: string): Promise<boolean> {
  const result = await getPool().query(
    'DELETE FROM diff_baselines WHERE api_key_id = $1 AND name = $2 RETURNING id',
    [apiKeyId, name],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function listBaselines(apiKeyId: string): Promise<Baseline[]> {
  const result = await getPool().query(
    `SELECT id, api_key_id, name, storage_path, width, height, created_at
     FROM diff_baselines WHERE api_key_id = $1
     ORDER BY name ASC`,
    [apiKeyId],
  );
  return result.rows.map(mapRow);
}

function mapRow(row: Record<string, unknown>): Baseline {
  return {
    id: row.id as string,
    apiKeyId: row.api_key_id as string,
    name: row.name as string,
    storagePath: row.storage_path as string,
    width: row.width as number | null,
    height: row.height as number | null,
    createdAt: row.created_at as Date,
  };
}

export class BaselineLimitError extends Error {
  constructor() {
    super('Maximum of 50 baselines per API key reached');
    this.name = 'BaselineLimitError';
  }
}
