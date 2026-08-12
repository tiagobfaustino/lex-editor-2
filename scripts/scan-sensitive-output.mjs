// Scans generated logs and artifacts without printing matched credential bytes.
// Usage: node scripts/scan-sensitive-output.mjs [path ...]

import { lstat, readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024;

export const SENSITIVE_CONTENT_PATTERNS = Object.freeze([
  { pattern: /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/u, rule: 'private key' },
  { pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/u, rule: 'Supabase secret key' },
  { pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/u, rule: 'GitHub token' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/u, rule: 'AWS access key' },
  { pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u, rule: 'API token' },
  {
    pattern: /\bSUPABASE_(?:SERVICE_ROLE|SECRET)_KEY\s*[:=]\s*[^\s"']{12,}/u,
    rule: 'Supabase credential assignment',
  },
  {
    pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/iu,
    rule: 'bearer token',
  },
]);

export const PRIVATE_PATH_PATTERNS = Object.freeze([
  { pattern: /\/home\/[A-Za-z0-9._-]+\//u, rule: 'Linux home path' },
  { pattern: /\/Users\/[A-Za-z0-9._-]+\//u, rule: 'macOS home path' },
  { pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/u, rule: 'Windows home path' },
]);

const isText = (bytes) => !bytes.subarray(0, 8_192).includes(0);

const collectFiles = async (path) => {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  if (info.isSymbolicLink()) return [];
  if (info.isFile()) return [path];
  if (!info.isDirectory()) return [];

  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    files.push(...(await collectFiles(resolve(path, entry.name))));
  }
  return files;
};

export const scanSensitiveOutput = async (inputPaths) => {
  const roots = inputPaths.map((path) => resolve(path));
  const violations = [];
  let scannedFiles = 0;

  for (const root of roots) {
    for (const file of await collectFiles(root)) {
      const info = await lstat(file);
      if (info.size > MAX_TEXT_FILE_BYTES) continue;
      const bytes = await readFile(file);
      if (!isText(bytes)) continue;
      scannedFiles += 1;
      const text = bytes.toString('utf8');
      for (const { pattern, rule } of [...SENSITIVE_CONTENT_PATTERNS, ...PRIVATE_PATH_PATTERNS]) {
        if (pattern.test(text)) {
          violations.push({
            rule,
            path: relative(process.cwd(), file) || file,
          });
        }
      }
    }
  }

  return { scannedFiles, violations };
};

const isMain =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const inputPaths = process.argv.slice(2);
  if (inputPaths.length === 0) {
    console.error('Informe ao menos um diretório ou arquivo para varredura.');
    process.exitCode = 2;
  } else {
    const result = await scanSensitiveOutput(inputPaths);
    if (result.violations.length > 0) {
      console.error(`${String(result.violations.length)} violação(ões) sensíveis:`);
      for (const violation of result.violations) {
        console.error(`  - ${violation.rule}: ${violation.path}`);
      }
      process.exitCode = 1;
    } else {
      console.log(`Varredura sensível: ${String(result.scannedFiles)} arquivo(s), sem violações.`);
    }
  }
}
