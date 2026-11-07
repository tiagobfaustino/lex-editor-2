import { describe, expect, it, vi } from 'vitest';

import {
  UpdateWorkerDatabaseError,
  createPostgresLegislativeUpdateWorkerQueue,
  type UpdateWorkerSqlClient,
} from '../../services/update-worker/src/index.js';
import type { LegislativeUpdateProposal } from '../../services/update-worker/src/contracts.js';

const UPDATE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const LAW_ID = '22222222-2222-4222-8222-222222222222';
const BASE_VERSION_ID = '33333333-3333-4333-8333-333333333333';
const ARTIFACT_ID = '44444444-4444-4444-8444-444444444444';

const proposal = {
  lawId: LAW_ID,
  lawSigla: 'lei-teste',
  lawTitle: 'Lei de teste',
  sourceUrl: 'https://example.invalid/lei-teste',
  baseVersionId: BASE_VERSION_ID,
  baseNormativeSha256: 'a'.repeat(64),
  candidateNormativeSha256: 'b'.repeat(64),
  detectionKey: 'c'.repeat(64),
  sourceArtifacts: [
    {
      sourceType: 'planalto_html',
      sourceRole: 'primary_current',
      sourceVariant: 'compiled',
      sourceUrl: 'https://example.invalid/lei-teste',
      artifactSha256: 'd'.repeat(64),
    },
  ],
  candidateArtifactId: ARTIFACT_ID,
  diff: {
    schemaVersion: 1,
    entries: [],
    missingPublished: [],
    summary: {
      unchanged: 0,
      amended: 1,
      included: 0,
      revoked: 0,
      renumbered: 0,
      missingPublished: 0,
    },
    requiresHumanReview: true,
  },
  overallConfidence: 'high' as const,
  requiresHumanReview: true,
  detectedAt: '2026-08-20T12:00:00.000Z',
} satisfies LegislativeUpdateProposal;

const createSql = (responses: readonly unknown[]) => {
  let index = 0;
  const spy = vi.fn((text: string, parameters?: readonly unknown[]) => {
    void text;
    void parameters;
    return Promise.resolve([{ value: responses[index++] }]);
  });
  const sql: UpdateWorkerSqlClient = {
    query: <T extends Record<string, unknown>>(text: string, parameters?: readonly unknown[]) =>
      spy(text, parameters) as unknown as Promise<readonly T[]>,
  };
  return { sql, spy };
};

describe('createPostgresLegislativeUpdateWorkerQueue', () => {
  it('envia proposta e erro somente às RPCs permitidas ao worker', async () => {
    const { sql, spy } = createSql([
      { updateId: UPDATE_ID, created: true, supersededUpdateIds: [] },
      { updateId: UPDATE_ID },
    ]);
    const queue = createPostgresLegislativeUpdateWorkerQueue({ sql });

    await expect(queue.upsertProposal(proposal)).resolves.toEqual({
      updateId: UPDATE_ID,
      created: true,
      supersededUpdateIds: [],
    });
    await expect(
      queue.recordError({
        lawId: LAW_ID,
        lawSigla: 'lei-teste',
        lawTitle: 'Lei de teste',
        sourceUrl: 'https://example.invalid/lei-teste',
        baseVersionId: BASE_VERSION_ID,
        baseNormativeSha256: 'a'.repeat(64),
        failureKey: 'e'.repeat(64),
        errorCode: 'SOURCE_TIMEOUT',
        occurredAt: '2026-08-20T12:00:00.000Z',
      }),
    ).resolves.toEqual({ updateId: UPDATE_ID });

    expect(spy).toHaveBeenNthCalledWith(
      1,
      'select private.enqueue_legislative_update($1::jsonb) as value',
      [proposal],
    );
    expect(spy).toHaveBeenNthCalledWith(
      2,
      'select private.record_legislative_update_error($1::jsonb) as value',
      [expect.objectContaining({ errorCode: 'SOURCE_TIMEOUT' })],
    );
  });

  it('reivindica requests de reprocessamento por lote limitado e preserva a correlação', async () => {
    const { sql, spy } = createSql([
      [{ updateId: UPDATE_ID, lawId: LAW_ID, requestId: REQUEST_ID }],
    ]);
    const queue = createPostgresLegislativeUpdateWorkerQueue({ sql });

    await expect(queue.claimReprocessRequests(20)).resolves.toEqual([
      { updateId: UPDATE_ID, lawId: LAW_ID, requestId: REQUEST_ID },
    ]);
    expect(spy).toHaveBeenCalledWith(
      'select private.claim_legislative_update_reprocess_requests($1::integer) as value',
      [20],
    );
  });

  it('conclui somente a identidade reivindicada e valida o código redigido', async () => {
    const { sql, spy } = createSql([{ recorded: true }]);
    const queue = createPostgresLegislativeUpdateWorkerQueue({ sql });
    await expect(
      queue.completeReprocess(UPDATE_ID, REQUEST_ID, 'failed', 'SOURCE_TIMEOUT'),
    ).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith(
      'select private.complete_legislative_update_reprocess($1::uuid, $2::uuid, $3::text, $4::text) as value',
      [UPDATE_ID, REQUEST_ID, 'failed', 'SOURCE_TIMEOUT'],
    );
    await expect(
      queue.completeReprocess(UPDATE_ID, REQUEST_ID, 'failed', '/secret/path'),
    ).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejeita claim sem identidade de solicitação antes de executar', async () => {
    const { sql } = createSql([[{ updateId: UPDATE_ID, lawId: LAW_ID }]]);
    await expect(
      createPostgresLegislativeUpdateWorkerQueue({ sql }).claimReprocessRequests(20),
    ).rejects.toBeInstanceOf(UpdateWorkerDatabaseError);
  });

  it('rejeita resposta SQL malformada sem inventar um resultado', async () => {
    const { sql } = createSql([{ updateId: 'not-a-uuid', created: true, supersededUpdateIds: [] }]);
    const queue = createPostgresLegislativeUpdateWorkerQueue({ sql });

    await expect(queue.upsertProposal(proposal)).rejects.toBeInstanceOf(UpdateWorkerDatabaseError);
  });
});
