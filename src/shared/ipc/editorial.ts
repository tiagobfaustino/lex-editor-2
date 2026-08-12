import { z } from 'zod';

import { DesktopErrorDtoSchema } from './desktop-api.js';
import {
  DiagnosticSeveritySchema,
  PreviewDeviceStatusSchema,
  PreviewNodeKindSchema,
  SourceRangeDtoSchema,
} from './import.js';

export const EDITORIAL_GET_STATE_CHANNEL = 'editorial:get-state' as const;
export const EDITORIAL_CORRECT_TEXT_CHANNEL = 'editorial:correct-text' as const;
export const EDITORIAL_CONFIRM_INTERPRETATION_CHANNEL = 'editorial:confirm-interpretation' as const;
export const EDITORIAL_CONFIRM_WARNING_CHANNEL = 'editorial:confirm-warning' as const;
export const EDITORIAL_VALIDATE_CHANNEL = 'editorial:validate' as const;
export const EDITORIAL_APPROVE_CHANNEL = 'editorial:approve' as const;

export const DESKTOP_EDITORIAL_LIMITS = Object.freeze({
  commandBytes: 256 * 1024,
  stateBytes: 512 * 1024,
  maxTextCharacters: 200_000,
  maxReasonCharacters: 2_000,
  maxDiagnostics: 1_000,
  maxReviewTargets: 1_000,
} as const);

const OpaqueIdSchema = z.uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ReasonSchema = z.string().trim().min(2).max(DESKTOP_EDITORIAL_LIMITS.maxReasonCharacters);

export const GetEditorialStateCommandSchema = z.strictObject({ projectId: OpaqueIdSchema });

export const CorrectEditorialTextCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  previewNodeId: OpaqueIdSchema,
  value: z.string().trim().min(1).max(DESKTOP_EDITORIAL_LIMITS.maxTextCharacters),
  reason: ReasonSchema,
});

export const ConfirmEditorialInterpretationCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  previewNodeId: OpaqueIdSchema,
  reason: ReasonSchema,
});

export const ConfirmEditorialWarningCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  diagnosticId: OpaqueIdSchema,
  note: z.string().trim().min(1).max(DESKTOP_EDITORIAL_LIMITS.maxReasonCharacters).optional(),
});

export const ValidateEditorialCommandSchema = z.strictObject({ projectId: OpaqueIdSchema });
export const ApproveEditorialCommandSchema = z.strictObject({ projectId: OpaqueIdSchema });

export const EditorialDiagnosticDtoSchema = z.strictObject({
  diagnosticId: OpaqueIdSchema,
  severity: DiagnosticSeveritySchema,
  code: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u),
  message: z.string().min(1).max(2_000),
  blocksApproval: z.boolean(),
  blocksExport: z.boolean(),
  requiresConfirmation: z.boolean(),
  confirmed: z.boolean(),
  previewNodeId: OpaqueIdSchema.nullable(),
  blockId: z.string().min(1).max(240).nullable(),
  sourceRange: SourceRangeDtoSchema.nullable(),
});

export const EditorialReviewTargetDtoSchema = z.strictObject({
  previewNodeId: OpaqueIdSchema,
  nodeKind: PreviewNodeKindSchema,
  label: z.string().min(1).max(160),
  plainText: z.string().max(DESKTOP_EDITORIAL_LIMITS.maxTextCharacters),
  deviceStatus: PreviewDeviceStatusSchema.nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  confidenceReasons: z.array(z.string().min(1).max(120)).max(16),
  requiresHumanReview: z.boolean(),
  sourceRange: SourceRangeDtoSchema.nullable(),
});

export const EditorialStateDtoSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  revisionHash: Sha256Schema,
  journalSequence: z.number().int().nonnegative(),
  saveState: z.enum(['saved']),
  validatedAt: z.iso.datetime({ offset: true }).nullable(),
  validationMode: z.enum(['not_run', 'incremental', 'full']),
  validationIsComplete: z.boolean(),
  blockingCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  unconfirmedWarningCount: z.number().int().nonnegative(),
  reviewApprovalStatus: z.enum(['not_approved', 'approved', 'invalidated']),
  canApprove: z.boolean(),
  canExport: z.boolean(),
  diagnostics: z.array(EditorialDiagnosticDtoSchema).max(DESKTOP_EDITORIAL_LIMITS.maxDiagnostics),
  reviewTargets: z
    .array(EditorialReviewTargetDtoSchema)
    .max(DESKTOP_EDITORIAL_LIMITS.maxReviewTargets),
});

const createResultSchema = <Output extends z.ZodType>(outputSchema: Output) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: outputSchema }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);

export const GetEditorialStateResultSchema = createResultSchema(EditorialStateDtoSchema);
export const CorrectEditorialTextResultSchema = createResultSchema(EditorialStateDtoSchema);
export const ConfirmEditorialInterpretationResultSchema =
  createResultSchema(EditorialStateDtoSchema);
export const ConfirmEditorialWarningResultSchema = createResultSchema(EditorialStateDtoSchema);
export const ValidateEditorialResultSchema = createResultSchema(EditorialStateDtoSchema);
export const ApproveEditorialResultSchema = createResultSchema(EditorialStateDtoSchema);

export type GetEditorialStateCommand = z.infer<typeof GetEditorialStateCommandSchema>;
export type CorrectEditorialTextCommand = z.infer<typeof CorrectEditorialTextCommandSchema>;
export type ConfirmEditorialInterpretationCommand = z.infer<
  typeof ConfirmEditorialInterpretationCommandSchema
>;
export type ConfirmEditorialWarningCommand = z.infer<typeof ConfirmEditorialWarningCommandSchema>;
export type ValidateEditorialCommand = z.infer<typeof ValidateEditorialCommandSchema>;
export type ApproveEditorialCommand = z.infer<typeof ApproveEditorialCommandSchema>;
export type EditorialDiagnosticDto = z.infer<typeof EditorialDiagnosticDtoSchema>;
export type EditorialReviewTargetDto = z.infer<typeof EditorialReviewTargetDtoSchema>;
export type EditorialStateDto = z.infer<typeof EditorialStateDtoSchema>;
export type GetEditorialStateResult = z.infer<typeof GetEditorialStateResultSchema>;
export type CorrectEditorialTextResult = z.infer<typeof CorrectEditorialTextResultSchema>;
export type ConfirmEditorialInterpretationResult = z.infer<
  typeof ConfirmEditorialInterpretationResultSchema
>;
export type ConfirmEditorialWarningResult = z.infer<typeof ConfirmEditorialWarningResultSchema>;
export type ValidateEditorialResult = z.infer<typeof ValidateEditorialResultSchema>;
export type ApproveEditorialResult = z.infer<typeof ApproveEditorialResultSchema>;
