import { spawn } from 'node:child_process';
import { z } from 'zod';

import type { AuditSqlClient } from '../../../src/main/audit/remote-audit-provider.js';
export const PUBLICATION_AUDIT_ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

/** Test-only transport over the disposable container's local socket. No
 * password, SQL endpoint or database client is added to the production main. */
export const runDisposableSql = (
  containerName: string,
  text: string,
  user = 'postgres',
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        containerName,
        'psql',
        '--set',
        'ON_ERROR_STOP=1',
        '--username',
        user,
        '--dbname',
        'lex_audit_test',
        '--tuples-only',
        '--no-align',
      ],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr.resume();
    child.once('error', () => {
      reject(new Error('Disposable database transport failed.'));
    });
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString('utf8').trim());
      else reject(new Error('Disposable database request failed.'));
    });
    child.stdin.end(text);
  });
const literal = (input: unknown): string => {
  if (input === null || input === undefined) return 'null';
  let encoded: string;
  if (typeof input === 'object') encoded = JSON.stringify(input);
  else if (
    typeof input === 'string' ||
    typeof input === 'number' ||
    typeof input === 'boolean' ||
    typeof input === 'bigint'
  )
    encoded = String(input);
  else throw new Error('Invalid disposable SQL parameter.');
  return `'${encoded.replaceAll("'", "''")}'`;
};
export const createDisposableAuditSql = (
  containerName: string,
  user = 'postgres',
): AuditSqlClient => ({
  async query<T extends Record<string, unknown>>(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly T[]> {
    const substituted = text.replace(/\$(\d+)\b/gu, (_, index: string) =>
      literal(parameters[Number(index) - 1]),
    );
    const raw = await runDisposableSql(
      containerName,
      `select coalesce(json_agg(result_row), '[]'::json) from (${substituted}) result_row;`,
      user,
    );
    return z.array(z.record(z.string(), z.unknown())).parse(JSON.parse(raw) as unknown) as T[];
  },
});
