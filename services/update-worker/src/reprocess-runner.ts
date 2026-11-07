import { z } from 'zod';

import type {
  ClaimedLegislativeUpdateReprocess,
  LegislativeUpdateWorkerQueue,
} from './contracts.js';
import type { LegislativeUpdateJob, UpdateWorkerResult } from './worker.js';

const safeDetailCode = (error: unknown): string =>
  error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.message)
    ? error.message
    : 'UPDATE_REPROCESS_FAILED';

export type ReprocessBatchItem = Readonly<{
  requestId: string;
  updateId: string;
  lawId: string;
  outcome: 'completed' | 'failed';
  detailCode: string | null;
  recorded: boolean;
}>;

export const createLegislativeUpdateReprocessRunner = (options: {
  queue: LegislativeUpdateWorkerQueue;
  loadJob(claim: ClaimedLegislativeUpdateReprocess): Promise<LegislativeUpdateJob>;
  runJob(
    job: LegislativeUpdateJob,
    claim: ClaimedLegislativeUpdateReprocess,
  ): Promise<UpdateWorkerResult>;
}) => ({
  async runBatch(limit = 20): Promise<readonly ReprocessBatchItem[]> {
    const claims = await options.queue.claimReprocessRequests(z.int().min(1).max(100).parse(limit));
    const results: ReprocessBatchItem[] = [];
    for (const claim of claims) {
      let outcome: ReprocessBatchItem['outcome'] = 'completed';
      let detailCode: string | null = null;
      try {
        const job = await options.loadJob(claim);
        const result = await options.runJob(job, claim);
        if (result.kind === 'error') {
          outcome = 'failed';
          detailCode = result.errorCode;
        }
      } catch (error) {
        outcome = 'failed';
        detailCode = safeDetailCode(error);
      }
      const recorded = await options.queue.completeReprocess(
        claim.updateId,
        claim.requestId,
        outcome,
        detailCode,
      );
      results.push(Object.freeze({ ...claim, outcome, detailCode, recorded }));
    }
    return Object.freeze(results);
  },
});
