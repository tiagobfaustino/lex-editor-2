import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'dist/desktop-gateway');
await mkdir(directory, { recursive: true });
await build({
  entryPoints: [resolve(root, 'services/desktop-gateway/src/runtime.ts')],
  outfile: resolve(directory, 'server.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['postgres', 'defuddle', 'defuddle/*', 'linkedom', 'node:*'],
  tsconfig: resolve(root, 'tsconfig.node.json'),
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
});
