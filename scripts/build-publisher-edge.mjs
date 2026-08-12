import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const outfile = resolve(root, 'supabase/functions/publisher/generated/runtime.js');

await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(root, 'services/publisher/src/edge-runtime.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['postgres', 'node:*'],
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});
