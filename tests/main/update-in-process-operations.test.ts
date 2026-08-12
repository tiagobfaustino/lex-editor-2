import { createHash } from 'node:crypto';

import {
  calculateNormativeHash,
  createLegislativeStructuralDiff,
  identifiedMinima,
} from '@lex-editor/legal-domain';
import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryLegislativeUpdateQueue,
  createLegislativeUpdateReviewService,
} from '../../services/update-worker/src/index.js';
import {
  createInProcessLegislativeUpdateReviewOperations,
  projectLegislativeUpdateDetail,
} from '../../src/main/updates/in-process-operations.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const UPDATE_ID = '10000000-0000-4000-8000-000000000001';
const LAW_ID = '10000000-0000-4000-8000-000000000002';
const VERSION_ID = '10000000-0000-4000-8000-000000000003';
const ARTIFACT_ID = '10000000-0000-4000-8000-000000000004';
const ACTOR_ID = '10000000-0000-4000-8000-000000000005';
const PUBLICATION_ID = '10000000-0000-4000-8000-000000000006';
const NOW = '2026-08-11T15:00:00.000Z';

describe('operações locais de revisão legislativa', () => {
  it('projeta lista e diff limitados e executa rejeição/reprocessamento auditáveis', async () => {
    const queue = new InMemoryLegislativeUpdateQueue(
      () => UPDATE_ID,
      () => new Date(NOW),
    );
    const diff = createLegislativeStructuralDiff({
      previous: identifiedMinima,
      current: identifiedMinima,
    });
    if (!diff.ok) throw new Error('Diff inválido.');
    const normativeHash = calculateNormativeHash(identifiedMinima, sha256);
    const sourceHash = sha256('snapshot');
    await queue.upsertProposal({
      lawId: LAW_ID,
      lawSigla: identifiedMinima.sigla,
      lawTitle: identifiedMinima.titulo,
      sourceUrl: identifiedMinima.fonte,
      baseVersionId: VERSION_ID,
      baseNormativeSha256: normativeHash,
      candidateNormativeSha256: sha256(`${normativeHash}:candidate`),
      detectionKey: sha256(`${LAW_ID}:${VERSION_ID}:candidate`),
      sourceArtifacts: [
        {
          sourceType: 'planalto_html',
          sourceRole: 'primary_current',
          sourceVariant: 'compiled',
          sourceUrl: identifiedMinima.fonte,
          artifactSha256: sourceHash,
        },
      ],
      candidateArtifactId: ARTIFACT_ID,
      diff: diff.valor,
      overallConfidence: 'high',
      requiresHumanReview: false,
      detectedAt: NOW,
    });
    const publication = {
      prepareLegislativeUpdate: vi.fn(() => Promise.resolve({ publicationId: PUBLICATION_ID })),
    };
    const review = createLegislativeUpdateReviewService({ queue, publication });
    const operations = createInProcessLegislativeUpdateReviewOperations({
      queue,
      review,
      actorUserId: ACTOR_ID,
    });

    await expect(operations.getCounts()).resolves.toMatchObject({ pending: 1, actionable: 1 });
    await expect(
      operations.list({ updateReviewStatus: null, cursor: null, limit: 10 }),
    ).resolves.toMatchObject({ items: [{ updateId: UPDATE_ID, reprocessRequested: false }] });
    const record = await queue.findById(UPDATE_ID);
    if (record === null) throw new Error('Registro ausente.');
    const detail = projectLegislativeUpdateDetail(record);
    expect(detail.entries[0]?.before?.path).toEqual(['Art. 1']);
    expect(detail).not.toHaveProperty('candidateArtifactId');
    expect(detail).not.toHaveProperty('sourceArtifacts');
    expect(detail).not.toHaveProperty('candidateAst');

    await expect(
      operations.reject({
        updateId: UPDATE_ID,
        reason: 'A candidata precisa de nova conferência na fonte oficial.',
      }),
    ).resolves.toMatchObject({ updateReviewStatus: 'rejected' });
    await expect(operations.reprocess({ updateId: UPDATE_ID })).resolves.toMatchObject({
      updateReviewStatus: 'rejected',
      retryCount: 1,
      reprocessRequested: true,
    });
  });
});
