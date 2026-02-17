/**
 * generate-postman.ts
 * Converts the OpenAPI spec into a Postman collection v2.1
 * with environment variables for {{baseUrl}} and {{apiKey}}.
 * Usage: npx tsx scripts/generate-postman.ts
 *
 * Requires: generate:openapi to have been run first (reads docs/openapi.json).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// openapi-to-postmanv2 is CJS-only
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { convert } = require('openapi-to-postmanv2') as {
  convert: (
    input: { type: 'string'; data: string },
    options: Record<string, unknown>,
    cb: (err: Error | null, result: { result: boolean; output: Array<{ type: string; data: unknown }>; reason?: string }) => void,
  ) => void;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', 'docs');

/** Postman environment file structure */
interface PostmanEnvironment {
  id: string;
  name: string;
  _postman_variable_scope: 'environment';
  values: Array<{ key: string; value: string; type: 'default' | 'secret'; enabled: boolean }>;
}

function buildEnvironment(): PostmanEnvironment {
  return {
    id: 'screenforge-env',
    name: 'ScreenForge',
    _postman_variable_scope: 'environment',
    values: [
      { key: 'baseUrl', value: 'http://localhost:3000', type: 'default', enabled: true },
      { key: 'apiKey', value: 'sf_live_your_key_here', type: 'secret', enabled: true },
    ],
  };
}

async function main() {
  const specPath = join(docsDir, 'openapi.json');
  let specJson: string;

  try {
    specJson = await readFile(specPath, 'utf-8');
  } catch {
    console.error(`docs/openapi.json not found. Run 'npm run generate:openapi' first.`);
    process.exit(1);
  }

  console.log('Converting OpenAPI spec to Postman collection...');

  await new Promise<void>((resolve, reject) => {
    convert(
      { type: 'string', data: specJson },
      {
        requestNameSource: 'Fallback',
        indentCharacter: 'Space',
        collectionName: 'ScreenForge API',
        folderStrategy: 'Tags',
        includeAuthInfoInExample: true,
        enableOptionalParameters: false,
        keepImplicitHeaders: false,
        authType: 'apikey',
        authData: { headerKey: 'x-api-key', headerValue: '{{apiKey}}' },
      },
      async (err, result) => {
        if (err || !result.result) {
          reject(err ?? new Error(result.reason ?? 'Conversion failed'));
          return;
        }

        const collection = result.output[0]?.data as Record<string, unknown>;
        if (!collection) {
          reject(new Error('No collection output'));
          return;
        }

        // Patch variable references so examples use {{baseUrl}} and {{apiKey}}
        const collectionStr = JSON.stringify(collection)
          .replace(/http:\/\/localhost:3000/g, '{{baseUrl}}')
          .replace(/https:\/\/localhost:3000/g, '{{baseUrl}}');
        const patched = JSON.parse(collectionStr) as Record<string, unknown>;

        await mkdir(docsDir, { recursive: true });

        const collectionPath = join(docsDir, 'postman-collection.json');
        await writeFile(collectionPath, JSON.stringify(patched, null, 2) + '\n', 'utf-8');
        console.log(`Wrote ${collectionPath}`);

        const envPath = join(docsDir, 'postman-environment.json');
        await writeFile(envPath, JSON.stringify(buildEnvironment(), null, 2) + '\n', 'utf-8');
        console.log(`Wrote ${envPath}`);

        const info = patched.info as Record<string, unknown> | undefined;
        const itemCount = (patched.item as unknown[])?.length ?? 0;
        console.log(`Postman collection: "${info?.name}", ${itemCount} top-level folders`);
        resolve();
      },
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
