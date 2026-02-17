/**
 * generate-openapi.ts
 * Exports the ScreenForge OpenAPI spec as static JSON and YAML files.
 * Usage: npx tsx scripts/generate-openapi.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { buildServer } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', 'docs');

async function main() {
  process.env.API_KEY_SALT ??= 'generate-script-placeholder-32ch';
  process.env.NODE_ENV ??= 'development';

  console.log('Building server to extract OpenAPI spec...');
  const app = await buildServer({ skipBrowserInit: true });
  await app.ready();

  const spec = app.swagger();
  await app.close();

  await mkdir(docsDir, { recursive: true });

  const jsonPath = join(docsDir, 'openapi.json');
  const yamlPath = join(docsDir, 'openapi.yaml');

  await writeFile(jsonPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${jsonPath}`);

  await writeFile(yamlPath, yaml.dump(spec, { lineWidth: 120 }), 'utf-8');
  console.log(`Wrote ${yamlPath}`);

  const pathCount = Object.keys(spec.paths ?? {}).length;
  console.log(`OpenAPI spec: ${pathCount} paths, version ${spec.info?.version}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
