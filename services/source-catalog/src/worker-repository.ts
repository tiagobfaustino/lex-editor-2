import {
  capturedSourceCheckJobSchema,
  sourceCheckCompletionResultSchema,
  sourceCheckCompletionSchema,
  type CapturedSourceCheckJob,
  type SourceCheckCompletion,
  type SourceCheckCompletionResult,
} from '@lex-editor/source-ingestion';
import { z } from 'zod';

import type { SourceCatalogSqlClient } from './database.js';

export interface SourceCatalogWorkerRepository {
  claimDueChecks(claimedAt: string, limit: number): Promise<readonly CapturedSourceCheckJob[]>;
  completeCheck(completion: SourceCheckCompletion): Promise<SourceCheckCompletionResult>;
}

export const createSourceCatalogWorkerRepository = (
  sql: SourceCatalogSqlClient,
): SourceCatalogWorkerRepository => ({
  async claimDueChecks(claimedAt, limit) {
    const parsedClaimedAt = z.iso.datetime({ offset: true }).parse(claimedAt);
    const parsedLimit = z.int().min(1).max(100).parse(limit);
    const rows = await sql.query<Record<string, unknown>>(
      `select private.claim_due_source_checks($1::timestamptz, $2::integer) as value`,
      [parsedClaimedAt, parsedLimit],
    );
    if (rows.length !== 1 || rows[0]?.['value'] === undefined) {
      throw new Error('O claim das verificações de fontes falhou.');
    }
    return z.array(capturedSourceCheckJobSchema).max(100).parse(rows[0]['value']);
  },
  async completeCheck(rawCompletion) {
    const completion = sourceCheckCompletionSchema.parse(rawCompletion);
    const rows = await sql.query<Record<string, unknown>>(
      'select private.complete_source_check($1::jsonb) as value',
      [completion],
    );
    if (rows.length !== 1 || rows[0]?.['value'] === undefined) {
      throw new Error('A conclusão da verificação de fonte falhou.');
    }
    return sourceCheckCompletionResultSchema.parse(rows[0]['value']);
  },
});
