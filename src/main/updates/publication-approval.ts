import { calculateRevisionHash } from '@lex-editor/legal-domain';
import { createHash } from 'node:crypto';
import { legislativeCandidateArtifactSchema } from '../../../services/update-worker/src/candidate-artifacts.js';
import {
  LegislativeUpdateDecisionDtoSchema,
  LegislativeUpdateDetailDtoSchema,
  type LegislativeUpdateDecisionDto,
  type LegislativeUpdateDetailDto,
  type LegislativeUpdateIdCommand,
} from '../../shared/ipc/updates.js';
import type { createPublicationOperations, PublicationRemote } from '../publication/operations.js';
import type { LegislativeUpdateReviewOperations } from './desktop-service.js';

export const createUpdatePublicationApproval = (
  remote: PublicationRemote,
  publications: ReturnType<typeof createPublicationOperations>,
) => {
  const active = new Map<
    string,
    Readonly<{ userId: string; promise: Promise<LegislativeUpdateDecisionDto> }>
  >();
  const enrichUpdateDetail = async (
    _input: LegislativeUpdateIdCommand,
    detail: LegislativeUpdateDetailDto,
  ): Promise<LegislativeUpdateDetailDto> => {
    if (detail.publicationId === null) return detail;
    if (!(await publications.canAccessPublication(detail.publicationId))) return detail;
    return {
      ...detail,
      publicationConfirmation: await publications.getPreparedConfirmation(detail.publicationId),
    };
  };
  const approve: LegislativeUpdateReviewOperations['approve'] = async (input) => {
    const actor = remote.getActor();
    if (actor?.role !== 'editor_juridico') throw new Error('NOT_ALLOWED');
    const pending = active.get(input.updateId);
    if (pending !== undefined) {
      if (pending.userId !== actor.userId) throw new Error('NOT_ALLOWED');
      return pending.promise;
    }
    const promise = (async () => {
      const detail = await remote.request(
        '/updates/getDetail',
        { updateId: input.updateId },
        LegislativeUpdateDetailDtoSchema,
      );
      if (detail.updateId !== input.updateId) throw new Error('UPDATE_CANDIDATE_CONFLICT');
      if (detail.updateReviewStatus === 'approved' && detail.publicationId !== null) {
        return {
          ...LegislativeUpdateDecisionDtoSchema.parse({
            updateId: detail.updateId,
            updateReviewStatus: detail.updateReviewStatus,
            publicationId: detail.publicationId,
            retryCount: detail.retryCount,
            reprocessRequested: detail.reprocessRequested,
          }),
          publicationConfirmation: await publications.getPreparedConfirmation(detail.publicationId),
        };
      }
      const candidate = await remote.request(
        '/updates/getCandidate',
        { updateId: input.updateId },
        legislativeCandidateArtifactSchema,
      );
      if (
        candidate.lawId !== detail.lawId ||
        candidate.baseVersionId !== detail.baseVersionId ||
        detail.updateReviewStatus !== 'pending'
      )
        throw new Error('UPDATE_CANDIDATE_CONFLICT');
      const revisionHash = calculateRevisionHash(candidate.ast, (v) =>
        createHash('sha256').update(v).digest('hex'),
      );
      const confirmation =
        (await publications.findPreparedUpdate(
          input.updateId,
          candidate.candidateArtifactId,
          revisionHash,
          candidate.baseVersionId,
        )) ??
        (await publications.prepareSnapshot(
          input.updateId,
          {
            ast: candidate.ast,
            revisionHash,
            snapshots: candidate.snapshots.map(({ sha256, conteudo, referencia }) => ({
              sourceType: referencia.sourceType,
              sourceRole: referencia.sourceRole,
              sourceVariant: referencia.sourceVariant,
              ...(referencia.sourceUrl === undefined
                ? {}
                : { sourceUrl: referencia.sourceUrl, finalUrl: referencia.sourceUrl }),
              sourceArtifactSha256: sha256,
              capturedAt: detail.detectedAt,
              bytes: Buffer.from(conteudo, 'utf8'),
            })),
          },
          'Atualização conferida em fonte oficial.',
          { updateId: input.updateId, candidateArtifactId: candidate.candidateArtifactId },
        ));
      const proof = await publications.getPreparedProof(confirmation.publicationId);
      await publications.recordPreparedApproval(confirmation.publicationId);
      const decision = await remote.request(
        '/updates/approve',
        { updateId: input.updateId, publicationId: confirmation.publicationId, ...proof },
        LegislativeUpdateDecisionDtoSchema,
      );
      if (
        decision.updateId !== input.updateId ||
        decision.publicationId !== confirmation.publicationId ||
        decision.updateReviewStatus !== 'approved'
      )
        throw new Error('UPDATE_APPROVAL_MISMATCH');
      return { ...decision, publicationConfirmation: confirmation };
    })().finally(() => {
      active.delete(input.updateId);
    });
    active.set(input.updateId, { userId: actor.userId, promise });
    return promise;
  };
  return { approveUpdate: approve, enrichUpdateDetail };
};
