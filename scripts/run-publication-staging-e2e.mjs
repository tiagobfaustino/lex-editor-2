import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { build } from 'esbuild';

import { PRIVATE_PATH_PATTERNS, SENSITIVE_CONTENT_PATTERNS } from './scan-sensitive-output.mjs';

const root = resolve(import.meta.dirname, '..');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lex-staging-runner-'));
const outfile = join(temporaryRoot, 'runner.mjs');

try {
  await build({
    entryPoints: [resolve(root, 'scripts/run-publication-staging-e2e.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'silent',
  });
  const execution = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [outfile], {
      cwd: root,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) =>
      resolveExit({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
  });
  const combinedOutput = `${execution.stdout}\n${execution.stderr}`;
  const violations = [...SENSITIVE_CONTENT_PATTERNS, ...PRIVATE_PATH_PATTERNS].filter(
    ({ pattern }) => pattern.test(combinedOutput),
  );
  if (violations.length > 0) {
    console.error(
      `A saída do staging foi bloqueada por ${String(violations.length)} regra(s) sensível(is).`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(execution.stdout);
    process.stderr.write(execution.stderr);
    console.log('Varredura sensível do log de staging: sem violações.');
    if (execution.exitCode !== 0) process.exitCode = execution.exitCode;
  }
} finally {
  await rm(temporaryRoot, { recursive: true });
}
