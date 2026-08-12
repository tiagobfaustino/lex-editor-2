import { z } from 'zod';

import { DesktopErrorDtoSchema } from './desktop-api.js';

export const UPDATES_LIST_CHANNEL = 'updates:list' as const;
export const UPDATES_GET_DETAIL_CHANNEL = 'updates:get-detail' as const;
export const UPDATES_GET_COUNTS_CHANNEL = 'updates:get-counts' as const;
export const UPDATES_APPROVE_CHANNEL = 'updates:approve' as const;
export const UPDATES_REJECT_CHANNEL = 'updates:reject' as const;
export const UPDATES_REPROCESS_CHANNEL = 'updates:reprocess' as const;

export const DESKTOP_UPDATE_LIMITS = Object.freeze({
  commandBytes: 4 * 1024,
  listBytes: 256 * 1024,
  detailBytes: 2 * 1024 * 1024,
  decisionBytes: 8 * 1024,
  maxItems: 100,
  maxDiffEntries: 5_000,
  maxTextCharacters: 40_000,
  maxReasonCharacters: 2_000,
});

const uuidSchema = z.uuid();
const timestampSchema = z.iso.datetime();
const safeLine = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^[^\r\n]+$/u);

export const UpdateReviewStatusDtoSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'superseded',
  'error',
]);
export const UpdateConfidenceDtoSchema = z.enum(['high', 'medium', 'low']);
export const UpdateDiffCategoryDtoSchema = z.enum([
  'unchanged',
  'amended',
  'included',
  'revoked',
  'renumbered',
]);

export const UpdateDiffSummaryDtoSchema = z.strictObject({
  unchanged: z.int().nonnegative(),
  amended: z.int().nonnegative(),
  included: z.int().nonnegative(),
  revoked: z.int().nonnegative(),
  renumbered: z.int().nonnegative(),
  missingPublished: z.int().nonnegative(),
});

export const LegislativeUpdateItemDtoSchema = z.strictObject({
  updateId: uuidSchema,
  lawId: uuidSchema,
  lawSigla: safeLine(40),
  lawTitle: safeLine(240),
  sourceUrl: z.url(),
  updateReviewStatus: UpdateReviewStatusDtoSchema,
  summary: UpdateDiffSummaryDtoSchema,
  overallConfidence: UpdateConfidenceDtoSchema,
  requiresHumanReview: z.boolean(),
  detectedAt: timestampSchema,
  lastDetectedAt: timestampSchema,
  detectionCount: z.int().positive(),
  retryCount: z.int().nonnegative(),
  rejectionReason: safeLine(DESKTOP_UPDATE_LIMITS.maxReasonCharacters).nullable(),
  errorCode: safeLine(80).nullable(),
  publicationId: uuidSchema.nullable(),
  reprocessRequested: z.boolean(),
});

export const UpdateDiffSideDtoSchema = z.strictObject({
  blockId: safeLine(240),
  path: z.array(safeLine(240)).min(1).max(50),
  text: z.string().max(DESKTOP_UPDATE_LIMITS.maxTextCharacters),
  deviceStatus: z.enum([
    'active',
    'revoked',
    'vetoed',
    'included',
    'amended',
    'renumbered',
    'suspended',
    'unknown',
  ]),
});

export const UpdateDiffEntryDtoSchema = z.strictObject({
  category: UpdateDiffCategoryDtoSchema,
  affectedBlockId: safeLine(240).nullable(),
  before: UpdateDiffSideDtoSchema.nullable(),
  after: UpdateDiffSideDtoSchema.nullable(),
  confidence: UpdateConfidenceDtoSchema,
  confidenceReasons: z.array(safeLine(80)).max(20),
  requiresHumanReview: z.boolean(),
  renumberingEvidence: safeLine(500).nullable(),
});

export const LegislativeUpdateDetailDtoSchema = LegislativeUpdateItemDtoSchema.extend({
  baseVersionId: uuidSchema,
  entries: z.array(UpdateDiffEntryDtoSchema).max(DESKTOP_UPDATE_LIMITS.maxDiffEntries),
  missingPublishedBlockIds: z.array(safeLine(240)).max(DESKTOP_UPDATE_LIMITS.maxDiffEntries),
  truncated: z.boolean(),
});

export const LegislativeUpdateListDtoSchema = z.strictObject({
  items: z.array(LegislativeUpdateItemDtoSchema).max(DESKTOP_UPDATE_LIMITS.maxItems),
  nextCursor: timestampSchema.nullable(),
});

export const LegislativeUpdateCountsDtoSchema = z.strictObject({
  pending: z.int().nonnegative(),
  approved: z.int().nonnegative(),
  rejected: z.int().nonnegative(),
  superseded: z.int().nonnegative(),
  error: z.int().nonnegative(),
  actionable: z.int().nonnegative(),
});

export const LegislativeUpdateDecisionDtoSchema = z.strictObject({
  updateId: uuidSchema,
  updateReviewStatus: UpdateReviewStatusDtoSchema,
  publicationId: uuidSchema.nullable(),
  retryCount: z.int().nonnegative(),
  reprocessRequested: z.boolean(),
});

export const ListLegislativeUpdatesCommandSchema = z.strictObject({
  updateReviewStatus: UpdateReviewStatusDtoSchema.nullable(),
  cursor: timestampSchema.nullable(),
  limit: z.int().min(1).max(DESKTOP_UPDATE_LIMITS.maxItems),
});
export const LegislativeUpdateIdCommandSchema = z.strictObject({ updateId: uuidSchema });
export const GetLegislativeUpdateCountsCommandSchema = z.strictObject({});
export const ApproveLegislativeUpdateCommandSchema = z.strictObject({
  updateId: uuidSchema,
  acknowledged: z.literal(true),
});
export const RejectLegislativeUpdateCommandSchema = z.strictObject({
  updateId: uuidSchema,
  reason: safeLine(DESKTOP_UPDATE_LIMITS.maxReasonCharacters).min(10),
});

const resultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);

export const LegislativeUpdateListResultSchema = resultSchema(LegislativeUpdateListDtoSchema);
export const LegislativeUpdateDetailResultSchema = resultSchema(LegislativeUpdateDetailDtoSchema);
export const LegislativeUpdateCountsResultSchema = resultSchema(LegislativeUpdateCountsDtoSchema);
export const LegislativeUpdateDecisionResultSchema = resultSchema(
  LegislativeUpdateDecisionDtoSchema,
);

export type UpdateReviewStatusDto = z.infer<typeof UpdateReviewStatusDtoSchema>;
export type UpdateDiffSummaryDto = z.infer<typeof UpdateDiffSummaryDtoSchema>;
export type LegislativeUpdateItemDto = z.infer<typeof LegislativeUpdateItemDtoSchema>;
export type UpdateDiffEntryDto = z.infer<typeof UpdateDiffEntryDtoSchema>;
export type LegislativeUpdateDetailDto = z.infer<typeof LegislativeUpdateDetailDtoSchema>;
export type LegislativeUpdateListDto = z.infer<typeof LegislativeUpdateListDtoSchema>;
export type LegislativeUpdateCountsDto = z.infer<typeof LegislativeUpdateCountsDtoSchema>;
export type LegislativeUpdateDecisionDto = z.infer<typeof LegislativeUpdateDecisionDtoSchema>;
export type ListLegislativeUpdatesCommand = z.infer<typeof ListLegislativeUpdatesCommandSchema>;
export type LegislativeUpdateIdCommand = z.infer<typeof LegislativeUpdateIdCommandSchema>;
export type GetLegislativeUpdateCountsCommand = z.infer<
  typeof GetLegislativeUpdateCountsCommandSchema
>;
export type ApproveLegislativeUpdateCommand = z.infer<typeof ApproveLegislativeUpdateCommandSchema>;
export type RejectLegislativeUpdateCommand = z.infer<typeof RejectLegislativeUpdateCommandSchema>;
export type LegislativeUpdateListResult = z.infer<typeof LegislativeUpdateListResultSchema>;
export type LegislativeUpdateDetailResult = z.infer<typeof LegislativeUpdateDetailResultSchema>;
export type LegislativeUpdateCountsResult = z.infer<typeof LegislativeUpdateCountsResultSchema>;
export type LegislativeUpdateDecisionResult = z.infer<typeof LegislativeUpdateDecisionResultSchema>;
