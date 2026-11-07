import { createHash } from 'node:crypto';

import { calculateNormativeHash, identifiedMinima, origemMinima } from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createUpdatePublicationApproval } from '../../src/main/updates/publication-approval.js';
import type {
  createPublicationOperations,
  PublicationRemote,
} from '../../src/main/publication/operations.js';
import { PublicationConfirmationDtoSchema } from '../../src/shared/ipc/publication.js';
import { LegislativeUpdateDetailDtoSchema } from '../../src/shared/ipc/updates.js';

const UPDATE_ID = '11111111-1111-4111-8111-111111111111';
const LAW_ID = '22222222-2222-4222-8222-222222222222';
const BASE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const PUBLICATION_ID = '55555555-5555-4555-8555-555555555555';
const NEXT_PUBLICATION_ID = '66666666-6666-4666-8666-666666666666';
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const confirmation = PublicationConfirmationDtoSchema.parse({
  publicationId: PUBLICATION_ID,
  projectId: UPDATE_ID,
  revisionHash: 'a'.repeat(64),
  lawId: LAW_ID,
  lawTitle: identifiedMinima.titulo,
  sigla: identifiedMinima.sigla,
  version: '1.1.0',
  publicationNumber: 2,
  publicationKind: 'legislative_update',
  publicationImpact: 'normative_projection',
  restoredVersionId: null,
  restoredVersion: null,
  deviceCount: 1,
  artifactKinds: ['markdown', 'update_markdown', 'manifest', 'identified_ast', 'source_snapshot'],
  sourceSummary: 'Fonte oficial conferida.',
  changes: { included: 0, amended: 1, revoked: 0, renumbered: 0, items: [], truncated: false },
  requiresLegalApproval: true,
});

const harness = () => {
  let approved = false;
  let transientFailure = false;
  let role = 'editor_juridico';
  let userId = USER_ID;
  let detailGate: Promise<void> | null = null;
  let releaseDetail: () => void = () => {
    throw new Error('DETAIL_NOT_PAUSED');
  };
  let candidateBase = BASE_ID;
  let prepared: typeof confirmation | null = null;
  let preparations = 0;
  const effects: string[] = [];
  const candidate = () => ({
    schemaVersion: 1,
    candidateArtifactId: '77777777-7777-4777-8777-777777777777',
    lawId: LAW_ID,
    baseVersionId: candidateBase,
    baseNormativeSha256: 'b'.repeat(64),
    candidateNormativeSha256: calculateNormativeHash(identifiedMinima, hash),
    ast: structuredClone(identifiedMinima),
    snapshots: [
      {
        sha256: hash('Fonte íntegra.'),
        conteudo: 'Fonte íntegra.',
        referencia: {
          ...origemMinima,
          sourceArtifactSha256: hash('Fonte íntegra.'),
          fragmentSha256: hash('Fonte íntegra.'),
        },
      },
    ],
  });
  const detail = () =>
    LegislativeUpdateDetailDtoSchema.parse({
      updateId: UPDATE_ID,
      lawId: LAW_ID,
      lawSigla: identifiedMinima.sigla,
      lawTitle: identifiedMinima.titulo,
      sourceUrl: 'https://example.invalid/lei',
      updateReviewStatus: approved ? 'approved' : 'pending',
      summary: {
        unchanged: 0,
        amended: 1,
        included: 0,
        revoked: 0,
        renumbered: 0,
        missingPublished: 0,
      },
      overallConfidence: 'high',
      requiresHumanReview: true,
      detectedAt: '2026-10-08T12:00:00.000Z',
      lastDetectedAt: '2026-10-08T12:00:00.000Z',
      detectionCount: 1,
      retryCount: 0,
      rejectionReason: null,
      errorCode: null,
      publicationId: approved ? PUBLICATION_ID : null,
      reprocessRequested: false,
      baseVersionId: BASE_ID,
      entries: [],
      missingPublishedBlockIds: [],
      truncated: false,
    });
  const remote: PublicationRemote = {
    getActor: () => ({ userId, role }),
    request<T>(path: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
      effects.push(path);
      if (path === '/updates/getDetail') {
        const gate = detailGate;
        detailGate = null;
        return gate === null
          ? Promise.resolve(schema.parse(detail()))
          : gate.then(() => schema.parse(detail()));
      }
      if (path === '/updates/getCandidate') return Promise.resolve(schema.parse(candidate()));
      if (path === '/updates/approve') {
        if (transientFailure) {
          transientFailure = false;
          return Promise.reject(new Error('REMOTE_UNAVAILABLE'));
        }
        approved = true;
        return Promise.resolve(
          schema.parse({
            updateId: UPDATE_ID,
            updateReviewStatus: 'approved',
            publicationId: (input as { publicationId: string }).publicationId,
            retryCount: 0,
            reprocessRequested: false,
          }),
        );
      }
      return Promise.reject(new Error('UNEXPECTED_PUBLICATION_EFFECT'));
    },
  };
  const publications = {
    prepareSnapshot() {
      preparations += 1;
      effects.push('prepare');
      prepared = {
        ...confirmation,
        publicationId: preparations === 1 ? PUBLICATION_ID : NEXT_PUBLICATION_ID,
      };
      return Promise.resolve(prepared);
    },
    findPreparedUpdate() {
      return Promise.resolve(prepared);
    },
    getPreparedProof() {
      return Promise.resolve({ manifestCanonical: '{}', identifiedAstCanonical: '{}' });
    },
    recordPreparedApproval() {
      effects.push('publisher_approval');
      return Promise.resolve();
    },
    getPreparedConfirmation(publicationId: string) {
      if (publicationId !== PUBLICATION_ID)
        return Promise.reject(new Error('WRONG_PREPARED_PUBLICATION'));
      return Promise.resolve(confirmation);
    },
    canAccessPublication() {
      return Promise.resolve(true);
    },
    execute() {
      return Promise.reject(new Error('UNEXPECTED_PUBLICATION_EFFECT'));
    },
  } as unknown as ReturnType<typeof createPublicationOperations>;
  return {
    flow: createUpdatePublicationApproval(remote, publications),
    effects,
    setApproved() {
      approved = true;
    },
    setTransientFailure() {
      transientFailure = true;
    },
    setAdmin() {
      role = 'administrador_tecnico';
    },
    setOtherEditor() {
      userId = '99999999-9999-4999-8999-999999999999';
    },
    pauseGetDetail() {
      detailGate = new Promise<void>((resolve) => {
        releaseDetail = resolve;
      });
    },
    releaseGetDetail() {
      releaseDetail();
    },
    setWrongBase() {
      candidateBase = '88888888-8888-4888-8888-888888888888';
    },
  };
};

describe('update approval recovery boundaries', () => {
  it('reuses the durable publication when the approval gateway fails before committing', async () => {
    const state = harness();
    state.setTransientFailure();
    await expect(
      state.flow.approveUpdate({ updateId: UPDATE_ID, acknowledged: true }),
    ).rejects.toThrow('REMOTE_UNAVAILABLE');
    expect(
      await state.flow.approveUpdate({ updateId: UPDATE_ID, acknowledged: true }),
    ).toMatchObject({
      publicationId: PUBLICATION_ID,
      publicationConfirmation: { publicationId: PUBLICATION_ID },
    });
    expect(state.effects.filter((effect) => effect === 'prepare')).toHaveLength(1);
    expect(state.effects).not.toContain('/publisher');
  });

  it('recovers an approved update from its complete detail without creating another publication', async () => {
    const state = harness();
    state.setApproved();
    expect(
      await state.flow.approveUpdate({ updateId: UPDATE_ID, acknowledged: true }),
    ).toMatchObject({
      updateId: UPDATE_ID,
      updateReviewStatus: 'approved',
      publicationId: PUBLICATION_ID,
      publicationConfirmation: confirmation,
    });
    expect(state.effects).toEqual(['/updates/getDetail']);
  });

  it('blocks an administrator before remote or publication effects', async () => {
    const state = harness();
    state.setAdmin();
    await expect(
      state.flow.approveUpdate({ updateId: UPDATE_ID, acknowledged: true }),
    ).rejects.toThrow('NOT_ALLOWED');
    expect(state.effects).toEqual([]);
  });

  it('rejects a different editor joining an in-flight approval', async () => {
    const state = harness();
    state.pauseGetDetail();
    const first = state.flow
      .approveUpdate({ updateId: UPDATE_ID, acknowledged: true })
      .catch(() => null);
    state.setOtherEditor();
    const otherActor = state.flow.approveUpdate({ updateId: UPDATE_ID, acknowledged: true });
    state.releaseGetDetail();
    await expect(otherActor).rejects.toThrow('NOT_ALLOWED');
    await first;
    expect(state.effects.filter((effect) => effect === '/updates/getDetail')).toHaveLength(1);
  });

  it('blocks a candidate from a different baseline before publisher approval', async () => {
    const state = harness();
    state.setWrongBase();
    await expect(
      state.flow.approveUpdate({ updateId: UPDATE_ID, acknowledged: true }),
    ).rejects.toThrow('UPDATE_CANDIDATE_CONFLICT');
    expect(state.effects).toEqual(['/updates/getDetail', '/updates/getCandidate']);
  });
});
