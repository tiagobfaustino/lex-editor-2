import { z } from 'zod';

import {
  legislativeStructuralDiffSchema,
  sourceArtifactHashSchema,
} from '../../../packages/legal-domain/src/index.js';

export const updateUuidSchema = z.uuid();
export const updateDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const updateTimestampSchema = z.iso.datetime();
export const updateReviewStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'superseded',
  'error',
]);

export const updateOverallConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const legislativeUpdateProposalSchema = z.strictObject({
  lawId: updateUuidSchema,
  lawSigla: z.string().trim().min(1).max(40),
  lawTitle: z.string().trim().min(1).max(240),
  sourceUrl: z.url(),
  baseVersionId: updateUuidSchema,
  baseNormativeSha256: updateDigestSchema,
  candidateNormativeSha256: updateDigestSchema,
  detectionKey: updateDigestSchema,
  sourceArtifacts: z.array(sourceArtifactHashSchema).min(1).max(100),
  candidateArtifactId: updateUuidSchema,
  diff: legislativeStructuralDiffSchema,
  overallConfidence: updateOverallConfidenceSchema,
  requiresHumanReview: z.boolean(),
  detectedAt: updateTimestampSchema,
});

export const legislativeUpdateRecordSchema = legislativeUpdateProposalSchema
  .extend({
    candidateNormativeSha256: updateDigestSchema.nullable(),
    sourceArtifacts: z.array(sourceArtifactHashSchema).max(100),
    candidateArtifactId: updateUuidSchema.nullable(),
    diff: legislativeStructuralDiffSchema.nullable(),
    id: updateUuidSchema,
    updateReviewStatus: updateReviewStatusSchema,
    detectionCount: z.int().positive(),
    lastDetectedAt: updateTimestampSchema,
    approvedBy: updateUuidSchema.nullable(),
    approvedAt: updateTimestampSchema.nullable(),
    rejectedBy: updateUuidSchema.nullable(),
    rejectionReason: z.string().trim().min(10).max(2_000).nullable(),
    errorCode: z.string().trim().min(1).max(80).nullable(),
    retryCount: z.int().nonnegative(),
    supersededByUpdateId: updateUuidSchema.nullable(),
    publicationId: updateUuidSchema.nullable(),
    reprocessRequestedAt: updateTimestampSchema.nullable(),
  })
  .superRefine((record, context) => {
    if (
      record.updateReviewStatus === 'approved' &&
      (record.approvedBy === null || record.approvedAt === null || record.publicationId === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['updateReviewStatus'],
        message: 'Aprovação exige ator, instante e publicação vinculada.',
      });
    }
    if (
      record.updateReviewStatus === 'rejected' &&
      (record.rejectedBy === null || record.rejectionReason === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['updateReviewStatus'],
        message: 'Rejeição exige ator e motivo.',
      });
    }
    if (
      record.updateReviewStatus === 'error' &&
      (record.errorCode === null ||
        record.candidateNormativeSha256 !== null ||
        record.diff !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['updateReviewStatus'],
        message: 'Erro exige código e não pode fingir uma candidata validada.',
      });
    }
  });

export const legislativeUpdateErrorSchema = z.strictObject({
  lawId: updateUuidSchema,
  lawSigla: z.string().trim().min(1).max(40),
  lawTitle: z.string().trim().min(1).max(240),
  sourceUrl: z.url(),
  baseVersionId: updateUuidSchema,
  baseNormativeSha256: updateDigestSchema,
  failureKey: updateDigestSchema,
  errorCode: z.string().trim().min(1).max(80),
  occurredAt: updateTimestampSchema,
});

export type UpdateReviewStatus = z.infer<typeof updateReviewStatusSchema>;
export type UpdateOverallConfidence = z.infer<typeof updateOverallConfidenceSchema>;
export type LegislativeUpdateProposal = z.infer<typeof legislativeUpdateProposalSchema>;
export type LegislativeUpdateRecord = z.infer<typeof legislativeUpdateRecordSchema>;
export type LegislativeUpdateError = z.infer<typeof legislativeUpdateErrorSchema>;

export type ProposalUpsertResult = Readonly<{
  record: LegislativeUpdateRecord;
  created: boolean;
  supersededUpdateIds: readonly string[];
}>;

export interface LegislativeUpdateQueue {
  upsertProposal(proposal: LegislativeUpdateProposal): Promise<ProposalUpsertResult>;
  recordError(error: LegislativeUpdateError): Promise<LegislativeUpdateRecord>;
  findById(updateId: string): Promise<LegislativeUpdateRecord | null>;
  list(): Promise<readonly LegislativeUpdateRecord[]>;
  approve(
    updateId: string,
    actorUserId: string,
    publicationId: string,
  ): Promise<LegislativeUpdateRecord>;
  reject(updateId: string, actorUserId: string, reason: string): Promise<LegislativeUpdateRecord>;
  requestReprocess(updateId: string): Promise<LegislativeUpdateRecord>;
}

export type UpdateIdGenerator = () => string;
