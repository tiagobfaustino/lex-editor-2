import { z } from 'zod';

import { DesktopErrorDtoSchema } from './desktop-api.js';

export const REPROCESSING_REQUEST_CHANNEL = 'reprocessing:request' as const;
export const REPROCESSING_GET_STATE_CHANNEL = 'reprocessing:get-state' as const;

/**
 * Limites públicos do contrato desktop. Os handlers ainda aplicam o limite
 * serializado em bytes: cardinalidade e tamanho por campo não o substituem.
 */
export const DESKTOP_REPROCESSING_LIMITS = Object.freeze({
  commandBytes: 8 * 1_024,
  stateBytes: 4 * 1_024,
  maxReasonCharacters: 500,
} as const);

const OpaqueIdSchema = z.uuid();
const RevisionHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const stableCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{2,79}$/u);

export const ReprocessingPlanDtoSchema = z.enum([
  'from_source_snapshot',
  'from_identified_revision',
]);

export const ReprocessingStatusDtoSchema = z.enum([
  'running',
  'awaiting_promotion',
  'completed',
  'conflicted',
  'failed',
  'cancelled',
]);

export const RequestReprocessingCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  requestId: OpaqueIdSchema,
  plan: ReprocessingPlanDtoSchema,
  expectedRevisionHash: RevisionHashSchema,
  reason: z.string().min(1).max(DESKTOP_REPROCESSING_LIMITS.maxReasonCharacters),
  incidentId: OpaqueIdSchema.nullable(),
});

export const GetReprocessingStateCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
});

export const ReprocessingStateDtoSchema = z.strictObject({
  requestId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  incidentId: OpaqueIdSchema.nullable(),
  jobId: OpaqueIdSchema.nullable(),
  plan: ReprocessingPlanDtoSchema,
  reason: z.string().min(1).max(DESKTOP_REPROCESSING_LIMITS.maxReasonCharacters),
  status: ReprocessingStatusDtoSchema,
  resultingRevisionHash: RevisionHashSchema.nullable(),
  conflictCode: stableCodeSchema.nullable(),
});

const createResultSchema = <Output extends z.ZodType>(outputSchema: Output) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: outputSchema }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);

export const RequestReprocessingResultSchema = createResultSchema(ReprocessingStateDtoSchema);
export const GetReprocessingStateResultSchema = createResultSchema(
  ReprocessingStateDtoSchema.nullable(),
);

export type ReprocessingPlanDto = z.infer<typeof ReprocessingPlanDtoSchema>;
export type ReprocessingStatusDto = z.infer<typeof ReprocessingStatusDtoSchema>;
export type RequestReprocessingCommand = z.infer<typeof RequestReprocessingCommandSchema>;
export type GetReprocessingStateCommand = z.infer<typeof GetReprocessingStateCommandSchema>;
export type ReprocessingStateDto = z.infer<typeof ReprocessingStateDtoSchema>;
export type RequestReprocessingResult = z.infer<typeof RequestReprocessingResultSchema>;
export type GetReprocessingStateResult = z.infer<typeof GetReprocessingStateResultSchema>;
