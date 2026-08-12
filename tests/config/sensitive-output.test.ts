import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scanSensitiveOutput } from '../../scripts/scan-sensitive-output.mjs';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'lex-sensitive-output-'));
  roots.push(root);
  return root;
};

describe('generated-output sensitive data scanner', () => {
  it('accepts clean logs and ignores binary files', async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, 'publication.log'), 'publication completed for candidate abc123\n');
    await writeFile(join(root, 'screenshot.png'), Buffer.from([0, 1, 2, 3]));

    await expect(scanSensitiveOutput([root])).resolves.toEqual({
      scannedFiles: 1,
      violations: [],
    });
  });

  it('reports credential and private-path rules without returning matched bytes', async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, 'trace.log'),
      'SUPABASE_SECRET_KEY=sb_secret_this-is-a-fake-secret-value /home/editor/project\n',
    );

    const result = await scanSensitiveOutput([root]);

    expect(result.violations.map(({ rule }) => rule)).toEqual([
      'Supabase secret key',
      'Supabase credential assignment',
      'Linux home path',
    ]);
    expect(JSON.stringify(result.violations)).not.toContain('this-is-a-fake-secret-value');
  });
});
