import { z } from 'zod';

import {
  createLegislativeDetectionHashes,
  createLegislativeStructuralDiff,
  calculateNormativeHash,
  reconciliar,
  registrarPublicacao,
  type ExplicitRenumbering,
  type IdentifiedNormaAST,
  type SourceSnapshot,
} from '../../../packages/legal-domain/src/index.js';
import {
  legislativeUpdateProposalSchema,
  updateDigestSchema,
  updateUuidSchema,
  type LegislativeUpdateQueue,
  type UpdateOverallConfidence,
} from './contracts.js';
import {
  isScheduleDue,
  scheduleAfterFailure,
  scheduleAfterSuccess,
  updateScheduleSchema,
  type UpdateSchedule,
} from './scheduler.js';

export type LegislativeUpdateJob = Readonly<{
  lawId: string;
  lawSigla: string;
  lawTitle: string;
  sourceUrl: string;
  baseVersionId: string;
  baseNormativeSha256: string;
  publishedAst: IdentifiedNormaAST;
  schedule: UpdateSchedule;
}>;

export type CollectedLegislativeCandidate = Readonly<{
  snapshots: readonly SourceSnapshot[];
  candidateAst: IdentifiedNormaAST;
  candidateArtifactId: string;
  explicitRenumberings?: readonly ExplicitRenumbering[] | undefined;
}>;

export interface LegislativeSourceCollector {
  collect(job: LegislativeUpdateJob): Promise<CollectedLegislativeCandidate>;
}

export type UpdateWorkerResult =
  | Readonly<{ kind: 'not_due' | 'suspended'; schedule: UpdateSchedule }>
  | Readonly<{ kind: 'unchanged'; schedule: UpdateSchedule; normativeSha256: string }>
  | Readonly<{
      kind: 'proposal_created' | 'proposal_reused';
      schedule: UpdateSchedule;
      updateId: string;
      supersededUpdateIds: readonly string[];
    }>
  | Readonly<{ kind: 'error'; schedule: UpdateSchedule; updateId: string; errorCode: string }>;

const confidenceRank: Readonly<Record<UpdateOverallConfidence, number>> = {
  high: 3,
  medium: 2,
  low: 1,
};

const overallConfidence = (
  entries: readonly Readonly<{ confidence: UpdateOverallConfidence }>[],
): UpdateOverallConfidence =>
  entries.reduce<UpdateOverallConfidence>(
    (lowest, entry) =>
      confidenceRank[entry.confidence] < confidenceRank[lowest] ? entry.confidence : lowest,
    'high',
  );

const safeErrorCode = (error: unknown): string => {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.message)) return error.message;
  return 'UPDATE_PROCESSING_FAILED';
};

export const createLegislativeUpdateWorker = (options: {
  collector: LegislativeSourceCollector;
  queue: LegislativeUpdateQueue;
  sha256(value: string): string;
  now(): Date;
  random(): number;
}) => ({
  async run(rawJob: LegislativeUpdateJob): Promise<UpdateWorkerResult> {
    const job: LegislativeUpdateJob = {
      ...rawJob,
      lawId: updateUuidSchema.parse(rawJob.lawId),
      baseVersionId: updateUuidSchema.parse(rawJob.baseVersionId),
      baseNormativeSha256: updateDigestSchema.parse(rawJob.baseNormativeSha256),
      sourceUrl: z.url().parse(rawJob.sourceUrl),
      schedule: updateScheduleSchema.parse(rawJob.schedule),
    };
    const now = options.now();
    if (
      job.schedule.suspendedUntil !== null &&
      Date.parse(job.schedule.suspendedUntil) > now.getTime()
    ) {
      return { kind: 'suspended', schedule: job.schedule };
    }
    if (!isScheduleDue(job.schedule, now)) return { kind: 'not_due', schedule: job.schedule };

    try {
      if (
        calculateNormativeHash(job.publishedAst, (value) => options.sha256(value)) !==
        job.baseNormativeSha256
      ) {
        throw new Error('UPDATE_BASE_HASH_MISMATCH');
      }
      const collected = await options.collector.collect(job);
      updateUuidSchema.parse(collected.candidateArtifactId);
      const hashes = createLegislativeDetectionHashes({
        snapshots: collected.snapshots,
        ast: collected.candidateAst,
        sha256: (value) => options.sha256(value),
      });
      if (!hashes.ok) throw new Error('UPDATE_HASH_INVALID');
      const successfulSchedule = scheduleAfterSuccess(job.schedule, now);
      if (hashes.valor.normativeSha256 === job.baseNormativeSha256) {
        return {
          kind: 'unchanged',
          schedule: successfulSchedule,
          normativeSha256: hashes.valor.normativeSha256,
        };
      }

      const reconciled = reconciliar(
        collected.candidateAst,
        registrarPublicacao(job.publishedAst, job.lawSigla),
        job.lawSigla,
      );
      if (!reconciled.ok) throw new Error('UPDATE_IDENTITY_AMBIGUOUS');
      const diff = createLegislativeStructuralDiff({
        previous: job.publishedAst,
        current: reconciled.valor.arvore,
        explicitRenumberings: collected.explicitRenumberings,
      });
      if (!diff.ok) throw new Error('UPDATE_DIFF_INVALID');
      const detectionKey = updateDigestSchema.parse(
        options.sha256([job.lawId, job.baseVersionId, hashes.valor.normativeSha256].join('\u0000')),
      );
      const upserted = await options.queue.upsertProposal(
        legislativeUpdateProposalSchema.parse({
          lawId: job.lawId,
          lawSigla: job.lawSigla,
          lawTitle: job.lawTitle,
          sourceUrl: job.sourceUrl,
          baseVersionId: job.baseVersionId,
          baseNormativeSha256: job.baseNormativeSha256,
          candidateNormativeSha256: hashes.valor.normativeSha256,
          detectionKey,
          sourceArtifacts: hashes.valor.sourceArtifacts,
          candidateArtifactId: collected.candidateArtifactId,
          diff: diff.valor,
          overallConfidence: overallConfidence(diff.valor.entries),
          requiresHumanReview: diff.valor.requiresHumanReview,
          detectedAt: now.toISOString(),
        }),
      );
      return {
        kind: upserted.created ? 'proposal_created' : 'proposal_reused',
        schedule: successfulSchedule,
        updateId: upserted.record.id,
        supersededUpdateIds: upserted.supersededUpdateIds,
      };
    } catch (error) {
      const errorCode = safeErrorCode(error);
      const failedSchedule = scheduleAfterFailure({
        schedule: job.schedule,
        now,
        random: options.random(),
      });
      const failureKey = updateDigestSchema.parse(
        options.sha256([job.lawId, job.baseVersionId, errorCode].join('\u0000')),
      );
      const record = await options.queue.recordError({
        lawId: job.lawId,
        lawSigla: job.lawSigla,
        lawTitle: job.lawTitle,
        sourceUrl: job.sourceUrl,
        baseVersionId: job.baseVersionId,
        baseNormativeSha256: job.baseNormativeSha256,
        failureKey,
        errorCode,
        occurredAt: now.toISOString(),
      });
      return { kind: 'error', schedule: failedSchedule, updateId: record.id, errorCode };
    }
  },
});
