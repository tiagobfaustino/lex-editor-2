import { z } from 'zod';

import { DesktopErrorDtoSchema } from './desktop-api.js';

export const AUDIT_QUERY_CHANNEL = 'audit:query' as const;
export const AUDIT_GET_DETAIL_CHANNEL = 'audit:get-detail' as const;
export const AUDIT_GET_TIMELINE_CHANNEL = 'audit:get-timeline' as const;
export const AUDIT_GET_INCIDENT_CHANNEL = 'audit:get-incident' as const;
export const AUDIT_RECORD_INCIDENT_NOTE_CHANNEL = 'audit:record-incident-note' as const;
export const AUDIT_OPEN_EVIDENCE_CHANNEL = 'audit:open-evidence' as const;

export const DESKTOP_AUDIT_LIMITS = Object.freeze({
  commandBytes: 24 * 1_024,
  pageBytes: 256 * 1_024,
  detailBytes: 48 * 1_024,
  timelineBytes: 256 * 1_024,
  incidentBytes: 256 * 1_024,
  evidenceBytes: 32 * 1_024,
  maxPageItems: 100,
  maxTimelineItems: 200,
  maxSearchCharacters: 80,
  maxIntervalDays: 31,
  maxIncidentNoteChars: 280,
  maxEvidenceExcerptChars: 8_000,
  maxEvidenceLines: 200,
} as const);

const uuidSchema = z.uuid();
const nullableUuidSchema = uuidSchema.nullable();
const timestampSchema = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const gitShaSchema = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u);
const stableCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{2,79}$/u);

export const AuditLevelDtoSchema = z.enum(['info', 'warn', 'error']);
export const AuditOriginDtoSchema = z.enum([
  'desktop',
  'publisher',
  'update_worker',
  'source_catalog',
]);
export const AuditModuleDtoSchema = z.enum([
  'import',
  'extraction',
  'parser',
  'block_id',
  'validation',
  'export',
  'publication',
  'legislative_update',
  'source_catalog',
  'audit_integrity',
  'reprocessing',
  'evidence',
  'incident',
]);
export const AuditCategoryDtoSchema = z.enum([
  'pipeline',
  'publication',
  'legislative_update',
  'source_catalog',
  'audit_integrity',
  'reprocessing',
  'evidence',
  'incident',
]);
export const AuditActorRoleDtoSchema = z.enum([
  'system',
  'editor_juridico',
  'administrador_tecnico',
  'publisher_service',
  'update_worker',
  'source_catalog_admin',
  'source_catalog_worker',
]);

export const AUDIT_EVENT_CODES = [
  'import_started',
  'import_completed',
  'import_failed',
  'pipeline_cancelled',
  'extraction_completed',
  'extraction_failed',
  'parsing_completed',
  'parsing_failed',
  'identification_completed',
  'identification_failed',
  'validation_completed',
  'validation_blocked',
  'validation_failed',
  'export_completed',
  'export_failed',
  'publication_approval_recorded',
  'publication_pushed',
  'publication_syncing',
  'publication_published',
  'publication_failed',
  'legislative_update_created',
  'legislative_update_detected_again',
  'legislative_update_superseded',
  'legislative_update_approved',
  'legislative_update_rejected',
  'legislative_update_error_recorded',
  'legislative_update_reprocess_requested',
  'legislative_update_reprocess_claimed',
  'source_catalog_provider_revision_created',
  'source_catalog_binding_revision_created',
  'source_catalog_test_recorded',
  'source_catalog_binding_activated',
  'source_catalog_binding_paused',
  'source_catalog_binding_archived',
  'source_catalog_binding_restored',
  'source_check_requested',
  'source_check_claimed',
  'source_check_completed',
  'source_check_failed',
  'source_check_cancelled',
  'source_check_health_degraded',
  'source_check_health_suspended',
  'source_check_health_recovered',
  'audit_journal_integrity_failed',
  'audit_journal_opened',
  'reprocess_requested',
  'reprocess_started',
  'reprocess_conflicted',
  'reprocess_completed',
  'reprocess_failed',
  'reprocess_cancelled',
  'evidence_excerpt_opened',
  'evidence_excerpt_denied',
  'incident_note_recorded',
] as const;

export const AuditEventCodeDtoSchema = z.enum(AUDIT_EVENT_CODES);

export const AuditQueryFiltersSchema = z
  .strictObject({
    projectId: nullableUuidSchema,
    lawId: nullableUuidSchema,
    module: AuditModuleDtoSchema.nullable(),
    level: AuditLevelDtoSchema.nullable(),
    category: AuditCategoryDtoSchema.nullable(),
    eventCode: AuditEventCodeDtoSchema.nullable(),
    correlationId: nullableUuidSchema,
    incidentId: nullableUuidSchema,
    fromAt: timestampSchema.nullable(),
    toAt: timestampSchema.nullable(),
    searchText: z.string().trim().max(DESKTOP_AUDIT_LIMITS.maxSearchCharacters),
  })
  .superRefine((filters, context) => {
    if (filters.fromAt === null || filters.toAt === null) return;
    const from = Date.parse(filters.fromAt);
    const to = Date.parse(filters.toAt);
    if (from > to || to - from > DESKTOP_AUDIT_LIMITS.maxIntervalDays * 86_400_000) {
      context.addIssue({
        code: 'custom',
        path: ['toAt'],
        message: 'Intervalo de auditoria inválido.',
      });
    }
  });

export const AuditQueryCommandSchema = z.strictObject({
  filters: AuditQueryFiltersSchema,
  cursor: nullableUuidSchema,
  limit: z.int().min(1).max(DESKTOP_AUDIT_LIMITS.maxPageItems),
});

export const AuditEventListItemDtoSchema = z.strictObject({
  eventId: uuidSchema,
  occurredAt: timestampSchema,
  level: AuditLevelDtoSchema,
  module: AuditModuleDtoSchema,
  origin: AuditOriginDtoSchema,
  category: AuditCategoryDtoSchema,
  eventCode: AuditEventCodeDtoSchema,
  message: z.string().min(1).max(512),
  correlationId: uuidSchema,
  actorRole: AuditActorRoleDtoSchema,
  lawId: nullableUuidSchema,
  projectId: nullableUuidSchema,
  runId: nullableUuidSchema,
  incidentId: nullableUuidSchema,
  hasEvidence: z.boolean(),
});

export const AuditCompletenessDtoSchema = z.enum(['complete', 'local_only', 'partial']);
export const AuditUnavailableReasonDtoSchema = z.enum([
  'not_configured',
  'offline',
  'timeout',
  'access_denied',
  'invalid_response',
  'integrity_failed',
]);
export const AuditUnavailableOriginDtoSchema = z.strictObject({
  origin: AuditOriginDtoSchema,
  reason: AuditUnavailableReasonDtoSchema,
});

export const AuditPageDtoSchema = z.strictObject({
  items: z.array(AuditEventListItemDtoSchema).max(DESKTOP_AUDIT_LIMITS.maxPageItems),
  nextCursor: nullableUuidSchema,
  queryCutoff: timestampSchema,
  completeness: AuditCompletenessDtoSchema,
  unavailableOrigins: z.array(AuditUnavailableOriginDtoSchema).max(4),
});

const pipelineDetailDtoSchema = z.strictObject({
  kind: z.literal('pipeline'),
  stage: z.enum(['import', 'extraction', 'parsing', 'identification', 'validation', 'export']),
  outcome: z.enum(['started', 'completed', 'blocked', 'failed', 'cancelled']),
  durationMs: z.int().nonnegative().nullable(),
  processedUnits: z.int().nonnegative(),
  nodeCount: z.int().nonnegative(),
  warningCount: z.int().nonnegative(),
  errorCount: z.int().nonnegative(),
  sourceArtifactSha256: digestSchema.nullable(),
  fragmentSha256: digestSchema.nullable(),
  evidenceLocatorId: nullableUuidSchema,
  evidenceStartLine: z.int().positive().nullable(),
  evidenceEndLine: z.int().positive().nullable(),
});
const publicationDetailDtoSchema = z.strictObject({
  kind: z.literal('publication'),
  publicationId: uuidSchema,
  manifestDigest: digestSchema.nullable(),
  gitCommitSha: gitShaSchema.nullable(),
  failureCode: stableCodeSchema.nullable(),
});
const legislativeUpdateDetailDtoSchema = z.strictObject({
  kind: z.literal('legislative_update'),
  updateId: uuidSchema,
  baseNormativeSha256: digestSchema.nullable(),
  candidateNormativeSha256: digestSchema.nullable(),
  detailCode: stableCodeSchema.nullable(),
});
const sourceCatalogDetailDtoSchema = z.strictObject({
  kind: z.literal('source_catalog'),
  entityType: z.enum(['provider', 'binding', 'source_check']),
  entityId: uuidSchema,
  providerRevisionId: nullableUuidSchema,
  bindingRevisionId: nullableUuidSchema,
  detailCode: stableCodeSchema.nullable(),
});
const integrityDetailDtoSchema = z.strictObject({
  kind: z.literal('audit_integrity'),
  compromisedSequence: z.int().nonnegative().nullable(),
  reason: z.enum([
    'invalid_schema',
    'invalid_sequence',
    'previous_hash_mismatch',
    'entry_hash_mismatch',
    'truncated_entry',
    'unexpected_file_type',
  ]),
});
const reprocessingDetailDtoSchema = z.strictObject({
  kind: z.literal('reprocessing'),
  requestId: uuidSchema,
  plan: z.enum(['from_source_snapshot', 'from_identified_revision']),
  expectedRevisionHash: digestSchema,
  resultingRevisionHash: digestSchema.nullable(),
  conflictCode: stableCodeSchema.nullable(),
});
const evidenceDetailDtoSchema = z.strictObject({
  kind: z.literal('evidence'),
  evidenceLocatorId: uuidSchema,
  sourceArtifactSha256: digestSchema,
  startLine: z.int().positive(),
  endLine: z.int().positive(),
  result: z.enum(['opened', 'denied']),
});
const incidentDetailDtoSchema = z.strictObject({
  kind: z.literal('incident'),
  note: z.string().min(1).max(DESKTOP_AUDIT_LIMITS.maxIncidentNoteChars),
});

export const AuditEventDetailDataDtoSchema = z.discriminatedUnion('kind', [
  pipelineDetailDtoSchema,
  publicationDetailDtoSchema,
  legislativeUpdateDetailDtoSchema,
  sourceCatalogDetailDtoSchema,
  integrityDetailDtoSchema,
  reprocessingDetailDtoSchema,
  evidenceDetailDtoSchema,
  incidentDetailDtoSchema,
]);
export const AuditEventDetailDtoSchema = z.strictObject({
  event: AuditEventListItemDtoSchema,
  detail: AuditEventDetailDataDtoSchema,
});

export const AuditEventIdCommandSchema = z.strictObject({ eventId: uuidSchema });
export const AuditTimelineCommandSchema = z.strictObject({
  correlationId: uuidSchema,
  cursor: nullableUuidSchema,
  limit: z.int().min(1).max(DESKTOP_AUDIT_LIMITS.maxTimelineItems),
});
export const AuditTimelineDtoSchema = AuditPageDtoSchema;

export const IncidentResolutionStateDtoSchema = z.enum(['open', 'reprocessing', 'resolved']);
export const IncidentActionDtoSchema = z.enum([
  'record_note',
  'open_evidence',
  'request_reprocessing',
]);

export const IncidentDetailDtoSchema = z.strictObject({
  incidentId: uuidSchema,
  resolutionState: IncidentResolutionStateDtoSchema,
  events: z.array(AuditEventListItemDtoSchema).max(DESKTOP_AUDIT_LIMITS.maxTimelineItems),
  availableActions: z.array(IncidentActionDtoSchema).max(3),
  completeness: AuditCompletenessDtoSchema,
  unavailableOrigins: z.array(AuditUnavailableOriginDtoSchema).max(4),
});

export const IncidentIdCommandSchema = z.strictObject({ incidentId: uuidSchema });
export const RecordIncidentNoteCommandSchema = z.strictObject({
  incidentId: uuidSchema,
  note: z.string().trim().min(1).max(DESKTOP_AUDIT_LIMITS.maxIncidentNoteChars),
});

export const OpenEvidenceCommandSchema = z.strictObject({
  projectId: uuidSchema,
  evidenceLocatorId: uuidSchema,
});
export const EvidenceExcerptDtoSchema = z.strictObject({
  evidenceLocatorId: uuidSchema,
  sourceArtifactSha256: digestSchema,
  startLine: z.int().positive(),
  endLine: z.int().positive(),
  excerpt: z.string().max(DESKTOP_AUDIT_LIMITS.maxEvidenceExcerptChars),
  excerptSha256: digestSchema,
});

const resultSchema = <Value extends z.ZodType>(value: Value) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);

export const AuditQueryResultSchema = resultSchema(AuditPageDtoSchema);
export const AuditEventDetailResultSchema = resultSchema(AuditEventDetailDtoSchema);
export const AuditTimelineResultSchema = resultSchema(AuditTimelineDtoSchema);
export const IncidentDetailResultSchema = resultSchema(IncidentDetailDtoSchema);
export const EvidenceExcerptResultSchema = resultSchema(EvidenceExcerptDtoSchema);

export type AuditOriginDto = z.infer<typeof AuditOriginDtoSchema>;
export type AuditQueryFilters = z.infer<typeof AuditQueryFiltersSchema>;
export type AuditQueryCommand = z.infer<typeof AuditQueryCommandSchema>;
export type AuditEventListItemDto = z.infer<typeof AuditEventListItemDtoSchema>;
export type AuditEventDetailDataDto = z.infer<typeof AuditEventDetailDataDtoSchema>;
export type AuditEventDetailDto = z.infer<typeof AuditEventDetailDtoSchema>;
export type AuditEventIdCommand = z.infer<typeof AuditEventIdCommandSchema>;
export type AuditPageDto = z.infer<typeof AuditPageDtoSchema>;
export type AuditTimelineCommand = z.infer<typeof AuditTimelineCommandSchema>;
export type AuditQueryResult = z.infer<typeof AuditQueryResultSchema>;
export type AuditEventDetailResult = z.infer<typeof AuditEventDetailResultSchema>;
export type AuditTimelineResult = z.infer<typeof AuditTimelineResultSchema>;
export type IncidentResolutionStateDto = z.infer<typeof IncidentResolutionStateDtoSchema>;
export type IncidentActionDto = z.infer<typeof IncidentActionDtoSchema>;
export type IncidentDetailDto = z.infer<typeof IncidentDetailDtoSchema>;
export type IncidentIdCommand = z.infer<typeof IncidentIdCommandSchema>;
export type RecordIncidentNoteCommand = z.infer<typeof RecordIncidentNoteCommandSchema>;
export type IncidentDetailResult = z.infer<typeof IncidentDetailResultSchema>;
export type OpenEvidenceCommand = z.infer<typeof OpenEvidenceCommandSchema>;
export type EvidenceExcerptDto = z.infer<typeof EvidenceExcerptDtoSchema>;
export type EvidenceExcerptResult = z.infer<typeof EvidenceExcerptResultSchema>;
