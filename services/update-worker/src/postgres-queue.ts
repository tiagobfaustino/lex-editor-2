import { z } from 'zod';

import { legislativeCandidateArtifactSchema } from './candidate-artifacts.js';

import {
  legislativeUpdateErrorSchema,
  legislativeUpdateProposalSchema,
  updateUuidSchema,
  type ClaimedLegislativeUpdateReprocess,
  type LegislativeUpdateWorkerQueue,
  type WorkerErrorRecord,
  type WorkerProposalUpsertResult,
} from './contracts.js';

export interface UpdateWorkerSqlClient {
  query<T extends Record<string, unknown>>(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
}

export class UpdateWorkerDatabaseError extends Error {
  constructor(message = 'A persistência da atualização legislativa falhou.') {
    super(message);
  }
}

const upsertResultSchema = z.strictObject({
  updateId: updateUuidSchema,
  created: z.boolean(),
  supersededUpdateIds: z.array(updateUuidSchema),
});
const errorResultSchema = z.strictObject({ updateId: updateUuidSchema });
const claimedReprocessSchema = z.strictObject({
  requestId: updateUuidSchema,
  updateId: updateUuidSchema,
  lawId: updateUuidSchema,
});
const completeReprocessSchema = z.strictObject({ recorded: z.boolean() });

const valueFrom = <Value>(
  rows: readonly Record<string, unknown>[],
  schema: z.ZodType<Value>,
): Value => {
  if (rows.length !== 1 || rows[0]?.['value'] === undefined) throw new UpdateWorkerDatabaseError();
  const parsed = schema.safeParse(rows[0]['value']);
  if (!parsed.success) throw new UpdateWorkerDatabaseError();
  return parsed.data;
};

/**
 * Adaptador da workload `lex_update_worker`. Ele só chama RPCs privadas
 * concedidas a essa role; request editorial, aprovação e publicação continuam
 * fora desta porta e fora do Electron.
 */
export const createPostgresLegislativeUpdateWorkerQueue = (options: {
  sql: UpdateWorkerSqlClient;
}): LegislativeUpdateWorkerQueue => ({
  async saveCandidateArtifact(rawArtifact): Promise<void> {
    const artifact = legislativeCandidateArtifactSchema.parse(rawArtifact);
    const stored = valueFrom(
      await options.sql.query<Record<string, unknown>>(
        'select private.append_legislative_candidate_artifact($1::jsonb) as value',
        [artifact],
      ),
      z.strictObject({ candidateArtifactId: updateUuidSchema }),
    );
    if (stored.candidateArtifactId !== artifact.candidateArtifactId)
      throw new UpdateWorkerDatabaseError();
  },
  async upsertProposal(rawProposal): Promise<WorkerProposalUpsertResult> {
    const proposal = legislativeUpdateProposalSchema.parse(rawProposal);
    const value = valueFrom(
      await options.sql.query<Record<string, unknown>>(
        'select private.enqueue_legislative_update($1::jsonb) as value',
        [proposal],
      ),
      upsertResultSchema,
    );
    return {
      updateId: value.updateId,
      created: value.created,
      supersededUpdateIds: Object.freeze([...value.supersededUpdateIds]),
    };
  },
  async recordError(rawError): Promise<WorkerErrorRecord> {
    const error = legislativeUpdateErrorSchema.parse(rawError);
    const value = valueFrom(
      await options.sql.query<Record<string, unknown>>(
        'select private.record_legislative_update_error($1::jsonb) as value',
        [error],
      ),
      errorResultSchema,
    );
    return Object.freeze({ updateId: value.updateId });
  },
  async claimReprocessRequests(limit): Promise<readonly ClaimedLegislativeUpdateReprocess[]> {
    const claimLimit = z.int().min(1).max(100).parse(limit);
    const value = valueFrom(
      await options.sql.query<Record<string, unknown>>(
        'select private.claim_legislative_update_reprocess_requests($1::integer) as value',
        [claimLimit],
      ),
      z.array(claimedReprocessSchema),
    );
    return Object.freeze(value.map((claim) => Object.freeze(claim)));
  },
  async completeReprocess(updateId, requestId, outcome, detailCode): Promise<boolean> {
    const value = valueFrom(
      await options.sql.query<Record<string, unknown>>(
        'select private.complete_legislative_update_reprocess($1::uuid, $2::uuid, $3::text, $4::text) as value',
        [
          updateUuidSchema.parse(updateId),
          updateUuidSchema.parse(requestId),
          z.enum(['completed', 'failed']).parse(outcome),
          z
            .string()
            .regex(/^[A-Z][A-Z0-9_]{2,79}$/u)
            .nullable()
            .parse(detailCode),
        ],
      ),
      completeReprocessSchema,
    );
    return value.recorded;
  },
});
