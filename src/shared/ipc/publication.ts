import { z } from 'zod';

import { DesktopErrorDtoSchema } from './desktop-api.js';

export const PUBLICATION_PREPARE_CHANNEL = 'publication:prepare' as const;
export const PUBLICATION_EXECUTE_CHANNEL = 'publication:execute' as const;
export const PUBLICATION_GET_ATTEMPT_CHANNEL = 'publication:get-attempt' as const;
export const PUBLICATION_RETRY_CHANNEL = 'publication:retry' as const;
export const PUBLICATION_LIST_HISTORY_CHANNEL = 'publication:list-history' as const;
export const PUBLICATION_GET_DIFF_CHANNEL = 'publication:get-diff' as const;
export const PUBLICATION_PREPARE_ROLLBACK_CHANNEL = 'publication:prepare-rollback' as const;

export const DESKTOP_PUBLICATION_LIMITS = Object.freeze({
  commandBytes: 4 * 1024,
  attemptBytes: 8 * 1024,
  confirmationBytes: 64 * 1024,
  historyBytes: 128 * 1024,
  diffBytes: 256 * 1024,
  maxSummaryCharacters: 500,
  maxJustificationCharacters: 1_000,
  maxDiffItems: 2_000,
  maxHistoryItems: 100,
});

const uuidSchema = z.uuid();
const gitShaSchema = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const semverSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
const timestampSchema = z.iso.datetime();
const safeTextSchema = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^[^\r\n]+$/u);

export const PublicationKindDtoSchema = z.enum([
  'initial',
  'legislative_update',
  'editorial_correction',
  'rollback',
]);
export const PublicationImpactDtoSchema = z.enum([
  'representation_contract',
  'normative_projection',
  'editorial_metadata',
]);
export const PublicationAttemptStatusDtoSchema = z.enum([
  'prepared',
  'committed_local',
  'pushed',
  'syncing',
  'published',
  'failed',
]);
export const PublicationResumeStatusDtoSchema = z.enum([
  'prepared',
  'committed_local',
  'pushed',
  'syncing',
]);

export const PublicationChangeDtoSchema = z.strictObject({
  changeKind: z.enum(['included', 'amended', 'revoked', 'renumbered']),
  blockId: safeTextSchema(240),
  destinationBlockId: safeTextSchema(240).nullable(),
  description: safeTextSchema(280),
});

export const PublicationChangeSummaryDtoSchema = z.strictObject({
  included: z.int().nonnegative(),
  amended: z.int().nonnegative(),
  revoked: z.int().nonnegative(),
  renumbered: z.int().nonnegative(),
  items: z.array(PublicationChangeDtoSchema).max(DESKTOP_PUBLICATION_LIMITS.maxDiffItems),
  truncated: z.boolean(),
});

export const PublicationConfirmationDtoSchema = z.strictObject({
  publicationId: uuidSchema,
  projectId: uuidSchema,
  lawId: uuidSchema,
  lawTitle: safeTextSchema(240),
  sigla: safeTextSchema(40),
  version: semverSchema,
  publicationNumber: z.int().positive(),
  publicationKind: PublicationKindDtoSchema,
  publicationImpact: PublicationImpactDtoSchema,
  restoredVersionId: uuidSchema.nullable(),
  restoredVersion: semverSchema.nullable(),
  deviceCount: z.int().nonnegative(),
  artifactKinds: z
    .array(z.enum(['markdown', 'update_markdown', 'manifest', 'identified_ast', 'source_snapshot']))
    .min(4)
    .max(104),
  sourceSummary: safeTextSchema(DESKTOP_PUBLICATION_LIMITS.maxSummaryCharacters),
  changes: PublicationChangeSummaryDtoSchema,
  requiresLegalApproval: z.boolean(),
});

export const PublicationAttemptDtoSchema = z
  .strictObject({
    publicationId: uuidSchema,
    lawId: uuidSchema,
    version: semverSchema,
    publicationNumber: z.int().positive(),
    publicationKind: PublicationKindDtoSchema,
    publicationAttemptStatus: PublicationAttemptStatusDtoSchema,
    resumeFromStatus: PublicationResumeStatusDtoSchema.nullable(),
    candidateSha: gitShaSchema.nullable(),
    manifestDigest: digestSchema,
    publishedVersionId: uuidSchema.nullable(),
    updatedAt: timestampSchema,
    retryable: z.boolean(),
    message: safeTextSchema(160),
  })
  .superRefine((attempt, context) => {
    const published = attempt.publicationAttemptStatus === 'published';
    if (published !== (attempt.publishedVersionId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['publishedVersionId'],
        message: 'Published evidence must exist only for a published attempt.',
      });
    }
    if (attempt.publicationAttemptStatus !== 'failed' && attempt.resumeFromStatus !== null) {
      context.addIssue({
        code: 'custom',
        path: ['resumeFromStatus'],
        message: 'Only failed attempts can declare a resume stage.',
      });
    }
    if (published && attempt.retryable) {
      context.addIssue({
        code: 'custom',
        path: ['retryable'],
        message: 'A published attempt is terminal.',
      });
    }
  });

export const PublicationHistoryItemDtoSchema = z.strictObject({
  versionId: uuidSchema,
  lawId: uuidSchema,
  version: semverSchema,
  publicationNumber: z.int().positive(),
  publicationKind: PublicationKindDtoSchema,
  restoredVersionId: uuidSchema.nullable(),
  gitCommitSha: gitShaSchema,
  publishedAt: timestampSchema,
  isCurrent: z.boolean(),
  sourceSummary: safeTextSchema(DESKTOP_PUBLICATION_LIMITS.maxSummaryCharacters),
});

export const PublicationHistoryPageDtoSchema = z.strictObject({
  items: z.array(PublicationHistoryItemDtoSchema).max(DESKTOP_PUBLICATION_LIMITS.maxHistoryItems),
  nextCursor: z.string().min(1).max(200).nullable(),
  totalItems: z.int().nonnegative(),
});

export const PublicationDiffDtoSchema = z.strictObject({
  lawId: uuidSchema,
  fromVersionId: uuidSchema,
  toVersionId: uuidSchema,
  fromVersion: semverSchema,
  toVersion: semverSchema,
  publicationImpact: PublicationImpactDtoSchema,
  requiresLegalApproval: z.boolean(),
  changes: PublicationChangeSummaryDtoSchema,
});

export const PreparePublicationCommandSchema = z.strictObject({
  projectId: uuidSchema,
  sourceSummary: safeTextSchema(DESKTOP_PUBLICATION_LIMITS.maxSummaryCharacters),
});
export const PublicationIdCommandSchema = z.strictObject({ publicationId: uuidSchema });
export const ListPublicationHistoryCommandSchema = z.strictObject({
  projectId: uuidSchema,
  cursor: z.string().min(1).max(200).nullable(),
  limit: z.int().min(1).max(DESKTOP_PUBLICATION_LIMITS.maxHistoryItems),
});
export const GetPublicationDiffCommandSchema = z.strictObject({
  projectId: uuidSchema,
  fromVersionId: uuidSchema,
  toVersionId: uuidSchema,
});
export const PrepareRollbackCommandSchema = z.strictObject({
  projectId: uuidSchema,
  restoreVersionId: uuidSchema,
  justification: safeTextSchema(DESKTOP_PUBLICATION_LIMITS.maxJustificationCharacters).min(10),
});

const resultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);

export const PreparePublicationResultSchema = resultSchema(PublicationConfirmationDtoSchema);
export const PublicationAttemptResultSchema = resultSchema(PublicationAttemptDtoSchema);
export const PublicationHistoryResultSchema = resultSchema(PublicationHistoryPageDtoSchema);
export const PublicationDiffResultSchema = resultSchema(PublicationDiffDtoSchema);
export const PrepareRollbackResultSchema = resultSchema(PublicationConfirmationDtoSchema);

export type PublicationKindDto = z.infer<typeof PublicationKindDtoSchema>;
export type PublicationImpactDto = z.infer<typeof PublicationImpactDtoSchema>;
export type PublicationAttemptStatusDto = z.infer<typeof PublicationAttemptStatusDtoSchema>;
export type PublicationResumeStatusDto = z.infer<typeof PublicationResumeStatusDtoSchema>;
export type PublicationChangeDto = z.infer<typeof PublicationChangeDtoSchema>;
export type PublicationChangeSummaryDto = z.infer<typeof PublicationChangeSummaryDtoSchema>;
export type PublicationConfirmationDto = z.infer<typeof PublicationConfirmationDtoSchema>;
export type PublicationAttemptDto = z.infer<typeof PublicationAttemptDtoSchema>;
export type PublicationHistoryItemDto = z.infer<typeof PublicationHistoryItemDtoSchema>;
export type PublicationHistoryPageDto = z.infer<typeof PublicationHistoryPageDtoSchema>;
export type PublicationDiffDto = z.infer<typeof PublicationDiffDtoSchema>;
export type PreparePublicationCommand = z.infer<typeof PreparePublicationCommandSchema>;
export type PublicationIdCommand = z.infer<typeof PublicationIdCommandSchema>;
export type ListPublicationHistoryCommand = z.infer<typeof ListPublicationHistoryCommandSchema>;
export type GetPublicationDiffCommand = z.infer<typeof GetPublicationDiffCommandSchema>;
export type PrepareRollbackCommand = z.infer<typeof PrepareRollbackCommandSchema>;
export type PreparePublicationResult = z.infer<typeof PreparePublicationResultSchema>;
export type PublicationAttemptResult = z.infer<typeof PublicationAttemptResultSchema>;
export type PublicationHistoryResult = z.infer<typeof PublicationHistoryResultSchema>;
export type PublicationDiffResult = z.infer<typeof PublicationDiffResultSchema>;
export type PrepareRollbackResult = z.infer<typeof PrepareRollbackResultSchema>;
