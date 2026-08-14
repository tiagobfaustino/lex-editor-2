import {
  ingestConfiguredPlanaltoSourceSet,
  type IngestedPlanaltoSourceSet,
  type PlanaltoNetworkPorts,
} from '@lex-editor/source-ingestion/node';
import type { CapturedSourceCheckJob, SourceBindingHealth } from '@lex-editor/source-ingestion';
import type { ExplicitRenumbering, IdentifiedNormaAST } from '@lex-editor/legal-domain';

import type { SourceCatalogWorkerRepository } from '../../source-catalog/src/index.js';
import type { LegislativeUpdateQueue } from './contracts.js';
import { scheduleAfterFailure, type UpdateSchedule } from './scheduler.js';
import {
  createLegislativeUpdateWorker,
  type CollectedLegislativeCandidate,
  type LegislativeSourceCollector,
  type UpdateWorkerResult,
} from './worker.js';

export type PublishedLawBaseline = Readonly<{
  lawId: string;
  lawSigla: string;
  lawTitle: string;
  baseVersionId: string;
  baseNormativeSha256: string;
  publishedAst: IdentifiedNormaAST;
}>;

export interface PublishedLawBaselineRepository {
  load(lawId: string, baseVersionId: string): Promise<PublishedLawBaseline>;
}

export interface ConfiguredSourceSetParser {
  parse(
    input: Readonly<{
      job: CapturedSourceCheckJob;
      sourceSet: IngestedPlanaltoSourceSet;
    }>,
  ): Promise<
    Readonly<{
      candidateAst: IdentifiedNormaAST;
      candidateArtifactId: string;
      explicitRenumberings?: readonly ExplicitRenumbering[] | undefined;
    }>
  >;
}

export const createConfiguredLegislativeSourceCollector = (options: {
  capturedJob: CapturedSourceCheckJob;
  parser: ConfiguredSourceSetParser;
  networkPorts?: PlanaltoNetworkPorts;
}): LegislativeSourceCollector => ({
  async collect() {
    const sourceSet =
      options.networkPorts === undefined
        ? await ingestConfiguredPlanaltoSourceSet(
            options.capturedJob.providerRevision,
            options.capturedJob.bindingRevision,
          )
        : await ingestConfiguredPlanaltoSourceSet(
            options.capturedJob.providerRevision,
            options.capturedJob.bindingRevision,
            options.networkPorts,
          );
    if (
      sourceSet.providerRevisionId !== options.capturedJob.providerRevisionId ||
      sourceSet.bindingRevisionId !== options.capturedJob.bindingRevisionId
    ) {
      throw new Error('UPDATE_SOURCE_REVISION_MISMATCH');
    }
    const parsed = await options.parser.parse({ job: options.capturedJob, sourceSet });
    return {
      snapshots: sourceSet.artifacts.map(({ snapshot }) => snapshot),
      candidateAst: parsed.candidateAst,
      candidateArtifactId: parsed.candidateArtifactId,
      ...(parsed.explicitRenumberings === undefined
        ? {}
        : { explicitRenumberings: parsed.explicitRenumberings }),
    } satisfies CollectedLegislativeCandidate;
  },
});

export type SourceCatalogWorkerBatchItem = Readonly<{
  sourceCheckJobId: string;
  bindingRevisionId: string;
  result: UpdateWorkerResult | Readonly<{ kind: 'runner_error'; errorCode: string }>;
  healthApplied: boolean;
}>;

const safeErrorCode = (error: unknown): string =>
  error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.message)
    ? error.message
    : 'UPDATE_RUNNER_FAILED';

const scheduleFrom = (job: CapturedSourceCheckJob): UpdateSchedule => ({
  lawId: job.lawId,
  intervalMs: job.bindingRevision.monitoringIntervalMs,
  nextCheckAt: job.sourceCheckTrigger === 'manual' ? job.claimedAt : job.health.nextCheckAt,
  consecutiveFailures: job.health.consecutiveFailures,
  nextRetryAt: job.health.nextRetryAt,
  suspendedUntil: job.health.suspendedUntil,
});

const healthAfter = (
  job: CapturedSourceCheckJob,
  schedule: UpdateSchedule,
  result: UpdateWorkerResult | Readonly<{ kind: 'runner_error'; errorCode: string }>,
  checkedAt: string,
): SourceBindingHealth => {
  const failed = result.kind === 'error' || result.kind === 'runner_error';
  return {
    schemaVersion: 1,
    bindingId: job.bindingId,
    bindingRevisionId: job.bindingRevisionId,
    sourceHealthState: failed
      ? schedule.suspendedUntil === null
        ? 'degraded'
        : 'suspended'
      : 'healthy',
    nextCheckAt: schedule.nextCheckAt,
    consecutiveFailures: schedule.consecutiveFailures,
    nextRetryAt: schedule.nextRetryAt,
    suspendedUntil: schedule.suspendedUntil,
    lastErrorCode: failed ? result.errorCode : null,
    lastCheckedAt: checkedAt,
    updatedAt: checkedAt,
  };
};

export const createSourceCatalogLegislativeUpdateRunner = (options: {
  catalog: SourceCatalogWorkerRepository;
  baselines: PublishedLawBaselineRepository;
  parser: ConfiguredSourceSetParser;
  queue: LegislativeUpdateQueue;
  sha256(value: string): string;
  now(): Date;
  random(): number;
  networkPorts?: PlanaltoNetworkPorts;
}) => ({
  async runBatch(limit = 25): Promise<readonly SourceCatalogWorkerBatchItem[]> {
    const claimedAt = options.now().toISOString();
    const jobs = await options.catalog.claimDueChecks(claimedAt, limit);
    const results: SourceCatalogWorkerBatchItem[] = [];
    for (const job of jobs) {
      const initialSchedule = scheduleFrom(job);
      let result: SourceCatalogWorkerBatchItem['result'];
      let finalSchedule: UpdateSchedule;
      try {
        const baseline = await options.baselines.load(job.lawId, job.baseVersionId);
        if (baseline.lawId !== job.lawId || baseline.baseVersionId !== job.baseVersionId) {
          throw new Error('UPDATE_BASE_VERSION_MISMATCH');
        }
        const worker = createLegislativeUpdateWorker({
          collector: createConfiguredLegislativeSourceCollector({
            capturedJob: job,
            parser: options.parser,
            ...(options.networkPorts === undefined ? {} : { networkPorts: options.networkPorts }),
          }),
          queue: options.queue,
          sha256: (value) => options.sha256(value),
          now: () => new Date(claimedAt),
          random: () => options.random(),
        });
        result = await worker.run({
          lawId: baseline.lawId,
          lawSigla: baseline.lawSigla,
          lawTitle: baseline.lawTitle,
          sourceConfiguration: {
            providerRevision: job.providerRevision,
            bindingRevision: job.bindingRevision,
          },
          baseVersionId: baseline.baseVersionId,
          baseNormativeSha256: baseline.baseNormativeSha256,
          publishedAst: baseline.publishedAst,
          schedule: initialSchedule,
        });
        finalSchedule = result.schedule;
      } catch (error) {
        const errorCode = safeErrorCode(error);
        result = { kind: 'runner_error', errorCode };
        finalSchedule = scheduleAfterFailure({
          schedule: initialSchedule,
          now: new Date(claimedAt),
          random: options.random(),
        });
      }
      const failed = result.kind === 'error' || result.kind === 'runner_error';
      const detailCode =
        result.kind === 'error' || result.kind === 'runner_error' ? result.errorCode : null;
      const completion = await options.catalog.completeCheck({
        sourceCheckJobId: job.sourceCheckJobId,
        sourceCheckJobState: failed ? 'failed' : 'completed',
        detailCode,
        completedAt: claimedAt,
        health: healthAfter(job, finalSchedule, result, claimedAt),
      });
      results.push({
        sourceCheckJobId: job.sourceCheckJobId,
        bindingRevisionId: job.bindingRevisionId,
        result,
        healthApplied: completion.healthApplied,
      });
    }
    return results;
  },
});
