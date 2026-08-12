import {
  DESKTOP_UPDATE_LIMITS,
  LegislativeUpdateCountsDtoSchema,
  LegislativeUpdateDecisionDtoSchema,
  LegislativeUpdateDetailDtoSchema,
  LegislativeUpdateItemDtoSchema,
  LegislativeUpdateListDtoSchema,
  type LegislativeUpdateDecisionDto,
  type LegislativeUpdateDetailDto,
  type LegislativeUpdateItemDto,
} from '../../shared/ipc/updates.js';
import type {
  LegislativeUpdateQueue,
  LegislativeUpdateRecord,
} from '../../../services/update-worker/src/contracts.js';
import type { LegislativeUpdateReviewOperations } from './desktop-service.js';

type ReviewService = Readonly<{
  approve(updateId: string, actorUserId: string): Promise<LegislativeUpdateRecord>;
  reject(updateId: string, actorUserId: string, reason: string): Promise<LegislativeUpdateRecord>;
  requestReprocess(updateId: string): Promise<LegislativeUpdateRecord>;
}>;

const emptySummary = Object.freeze({
  unchanged: 0,
  amended: 0,
  included: 0,
  revoked: 0,
  renumbered: 0,
  missingPublished: 0,
});

const toItem = (record: LegislativeUpdateRecord): LegislativeUpdateItemDto =>
  LegislativeUpdateItemDtoSchema.parse({
    updateId: record.id,
    lawId: record.lawId,
    lawSigla: record.lawSigla,
    lawTitle: record.lawTitle,
    sourceUrl: record.sourceUrl,
    updateReviewStatus: record.updateReviewStatus,
    summary: record.diff?.summary ?? emptySummary,
    overallConfidence: record.overallConfidence,
    requiresHumanReview: record.requiresHumanReview,
    detectedAt: record.detectedAt,
    lastDetectedAt: record.lastDetectedAt,
    detectionCount: record.detectionCount,
    retryCount: record.retryCount,
    rejectionReason: record.rejectionReason,
    errorCode: record.errorCode,
    publicationId: record.publicationId,
    reprocessRequested: record.reprocessRequestedAt !== null,
  });

export const projectLegislativeUpdateDetail = (
  record: LegislativeUpdateRecord,
): LegislativeUpdateDetailDto => {
  const allEntries = record.diff?.entries ?? [];
  const entries = allEntries.slice(0, DESKTOP_UPDATE_LIMITS.maxDiffEntries).map((entry) => ({
    category: entry.category,
    affectedBlockId: entry.affectedBlockId,
    before:
      entry.before === null
        ? null
        : {
            blockId: entry.before.blockId,
            path: entry.before.path.map(({ label }) => label),
            text: entry.before.text,
            deviceStatus: entry.before.deviceStatus,
          },
    after:
      entry.after === null
        ? null
        : {
            blockId: entry.after.blockId,
            path: entry.after.path.map(({ label }) => label),
            text: entry.after.text,
            deviceStatus: entry.after.deviceStatus,
          },
    confidence: entry.confidence,
    confidenceReasons: entry.confidenceReasons,
    requiresHumanReview: entry.requiresHumanReview,
    renumberingEvidence: entry.renumberingEvidence,
  }));
  return LegislativeUpdateDetailDtoSchema.parse({
    ...toItem(record),
    baseVersionId: record.baseVersionId,
    entries,
    missingPublishedBlockIds: (record.diff?.missingPublished ?? [])
      .slice(0, DESKTOP_UPDATE_LIMITS.maxDiffEntries)
      .map(({ blockId }) => blockId),
    truncated:
      allEntries.length > entries.length ||
      (record.diff?.missingPublished.length ?? 0) > DESKTOP_UPDATE_LIMITS.maxDiffEntries,
  });
};

const toDecision = (record: LegislativeUpdateRecord): LegislativeUpdateDecisionDto =>
  LegislativeUpdateDecisionDtoSchema.parse({
    updateId: record.id,
    updateReviewStatus: record.updateReviewStatus,
    publicationId: record.publicationId,
    retryCount: record.retryCount,
    reprocessRequested: record.reprocessRequestedAt !== null,
  });

export const createInProcessLegislativeUpdateReviewOperations = (options: {
  queue: LegislativeUpdateQueue;
  review: ReviewService;
  actorUserId: string;
}): LegislativeUpdateReviewOperations => ({
  async list(input) {
    const records = (await options.queue.list()).filter(
      (record) =>
        input.updateReviewStatus === null || record.updateReviewStatus === input.updateReviewStatus,
    );
    const cursor = input.cursor;
    const before = cursor === null ? records : records.filter((item) => item.detectedAt < cursor);
    const page = before.slice(0, input.limit);
    return LegislativeUpdateListDtoSchema.parse({
      items: page.map(toItem),
      nextCursor: before.length > page.length ? (page.at(-1)?.detectedAt ?? null) : null,
    });
  },
  async getDetail(input) {
    const record = await options.queue.findById(input.updateId);
    if (record === null) throw new Error('UPDATE_NOT_FOUND');
    return projectLegislativeUpdateDetail(record);
  },
  async getCounts() {
    const records = await options.queue.list();
    const count = (value: LegislativeUpdateRecord['updateReviewStatus']): number =>
      records.filter(({ updateReviewStatus }) => updateReviewStatus === value).length;
    const pending = count('pending');
    const error = count('error');
    return LegislativeUpdateCountsDtoSchema.parse({
      pending,
      approved: count('approved'),
      rejected: count('rejected'),
      superseded: count('superseded'),
      error,
      actionable: pending + error,
    });
  },
  async approve(input) {
    return toDecision(await options.review.approve(input.updateId, options.actorUserId));
  },
  async reject(input) {
    return toDecision(
      await options.review.reject(input.updateId, options.actorUserId, input.reason),
    );
  },
  async reprocess(input) {
    return toDecision(await options.review.requestReprocess(input.updateId));
  },
});
