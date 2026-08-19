import { z } from 'zod';

import { containsSensitiveAuditText } from './redaction.js';

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const STABLE_CODE = /^[a-z][a-z0-9_]{2,79}$/u;

const uuidSchema = z.uuid();
const nullableUuidSchema = uuidSchema.nullable();
const timestampSchema = z.iso
  .datetime()
  .regex(UTC_TIMESTAMP, 'Expected a canonical UTC timestamp.');
const sha256Schema = z.string().regex(SHA256);
const gitShaSchema = z.string().regex(GIT_SHA);
const stableCodeSchema = z.string().regex(STABLE_CODE);

export const operationalAuditLevelSchema = z.enum(['info', 'warn', 'error']);
export const operationalAuditOriginSchema = z.enum([
  'desktop',
  'publisher',
  'update_worker',
  'source_catalog',
]);
export const operationalAuditModuleSchema = z.enum([
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
export const operationalAuditActorRoleSchema = z.enum([
  'system',
  'editor_juridico',
  'administrador_tecnico',
  'publisher_service',
  'update_worker',
  'source_catalog_admin',
  'source_catalog_worker',
]);

const pipelineEventCodeSchema = z.enum([
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
]);
const publicationEventCodeSchema = z.enum([
  'publication_approval_recorded',
  'publication_pushed',
  'publication_syncing',
  'publication_published',
  'publication_failed',
]);
const legislativeUpdateEventCodeSchema = z.enum([
  'legislative_update_created',
  'legislative_update_detected_again',
  'legislative_update_superseded',
  'legislative_update_approved',
  'legislative_update_rejected',
  'legislative_update_error_recorded',
  'legislative_update_reprocess_requested',
  'legislative_update_reprocess_claimed',
]);
const sourceCatalogEventCodeSchema = z.enum([
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
]);
const auditIntegrityEventCodeSchema = z.enum([
  'audit_journal_integrity_failed',
  'audit_journal_opened',
]);
const reprocessingEventCodeSchema = z.enum([
  'reprocess_requested',
  'reprocess_started',
  'reprocess_conflicted',
  'reprocess_completed',
  'reprocess_failed',
  'reprocess_cancelled',
]);
const evidenceEventCodeSchema = z.enum(['evidence_excerpt_opened', 'evidence_excerpt_denied']);
const incidentEventCodeSchema = z.enum(['incident_note_recorded']);

const pipelineDefinitionByCode = {
  import_started: { stage: 'import', outcome: 'started' },
  import_completed: { stage: 'import', outcome: 'completed' },
  import_failed: { stage: 'import', outcome: 'failed' },
  pipeline_cancelled: { stage: 'import', outcome: 'cancelled' },
  extraction_completed: { stage: 'extraction', outcome: 'completed' },
  extraction_failed: { stage: 'extraction', outcome: 'failed' },
  parsing_completed: { stage: 'parsing', outcome: 'completed' },
  parsing_failed: { stage: 'parsing', outcome: 'failed' },
  identification_completed: { stage: 'identification', outcome: 'completed' },
  identification_failed: { stage: 'identification', outcome: 'failed' },
  validation_completed: { stage: 'validation', outcome: 'completed' },
  validation_blocked: { stage: 'validation', outcome: 'blocked' },
  validation_failed: { stage: 'validation', outcome: 'failed' },
  export_completed: { stage: 'export', outcome: 'completed' },
  export_failed: { stage: 'export', outcome: 'failed' },
} as const;

const evidenceReferenceSchema = z.strictObject({
  evidenceLocatorId: uuidSchema,
  sourceArtifactSha256: sha256Schema,
  fragmentSha256: sha256Schema.nullable(),
  startLine: z.number().int().min(1).max(10_000_000),
  endLine: z.number().int().min(1).max(10_000_000),
});

const pipelineAuditDetailSchema = z.strictObject({
  kind: z.literal('pipeline'),
  eventCode: pipelineEventCodeSchema,
  stage: z.enum(['import', 'extraction', 'parsing', 'identification', 'validation', 'export']),
  outcome: z.enum(['started', 'completed', 'blocked', 'failed', 'cancelled']),
  durationMs: z.number().int().min(0).max(86_400_000).nullable(),
  processedUnits: z.number().int().min(0).max(10_000_000),
  nodeCount: z.number().int().min(0).max(10_000_000),
  warningCount: z.number().int().min(0).max(100_000),
  errorCount: z.number().int().min(0).max(100_000),
  sourceArtifactSha256: sha256Schema.nullable(),
  fragmentSha256: sha256Schema.nullable(),
  evidence: evidenceReferenceSchema.nullable(),
});

const publicationAuditDetailSchema = z.strictObject({
  kind: z.literal('publication'),
  eventCode: publicationEventCodeSchema,
  publicationId: uuidSchema,
  manifestDigest: sha256Schema.nullable(),
  gitCommitSha: gitShaSchema.nullable(),
  failureCode: stableCodeSchema.nullable(),
});

const legislativeUpdateAuditDetailSchema = z.strictObject({
  kind: z.literal('legislative_update'),
  eventCode: legislativeUpdateEventCodeSchema,
  updateId: uuidSchema,
  baseNormativeSha256: sha256Schema.nullable(),
  candidateNormativeSha256: sha256Schema.nullable(),
  detailCode: stableCodeSchema.nullable(),
});

const sourceCatalogAuditDetailSchema = z.strictObject({
  kind: z.literal('source_catalog'),
  eventCode: sourceCatalogEventCodeSchema,
  entityType: z.enum(['provider', 'binding', 'source_check']),
  entityId: uuidSchema,
  providerRevisionId: nullableUuidSchema,
  bindingRevisionId: nullableUuidSchema,
  detailCode: stableCodeSchema.nullable(),
});

const auditIntegrityDetailSchema = z.strictObject({
  kind: z.literal('audit_integrity'),
  eventCode: auditIntegrityEventCodeSchema,
  compromisedSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  reason: z.enum([
    'invalid_schema',
    'invalid_sequence',
    'previous_hash_mismatch',
    'entry_hash_mismatch',
    'truncated_entry',
    'unexpected_file_type',
  ]),
});

const reprocessingAuditDetailSchema = z.strictObject({
  kind: z.literal('reprocessing'),
  eventCode: reprocessingEventCodeSchema,
  requestId: uuidSchema,
  plan: z.enum(['from_source_snapshot', 'from_identified_revision']),
  expectedRevisionHash: sha256Schema,
  resultingRevisionHash: sha256Schema.nullable(),
  conflictCode: stableCodeSchema.nullable(),
});

const evidenceAuditDetailSchema = z.strictObject({
  kind: z.literal('evidence'),
  eventCode: evidenceEventCodeSchema,
  evidenceLocatorId: uuidSchema,
  sourceArtifactSha256: sha256Schema,
  startLine: z.number().int().min(1).max(10_000_000),
  endLine: z.number().int().min(1).max(10_000_000),
  result: z.enum(['opened', 'denied']),
});

export const MAX_INCIDENT_NOTE_CHARS = 280;

const incidentAuditDetailSchema = z.strictObject({
  kind: z.literal('incident'),
  eventCode: incidentEventCodeSchema,
  note: z
    .string()
    .min(1)
    .max(MAX_INCIDENT_NOTE_CHARS)
    .refine((value) => !containsSensitiveAuditText(value)),
});

export const operationalAuditDetailSchema = z
  .discriminatedUnion('kind', [
    pipelineAuditDetailSchema,
    publicationAuditDetailSchema,
    legislativeUpdateAuditDetailSchema,
    sourceCatalogAuditDetailSchema,
    auditIntegrityDetailSchema,
    reprocessingAuditDetailSchema,
    evidenceAuditDetailSchema,
    incidentAuditDetailSchema,
  ])
  .superRefine((detail, context) => {
    if (detail.kind === 'pipeline') {
      const definition = pipelineDefinitionByCode[detail.eventCode];
      if (detail.eventCode !== 'pipeline_cancelled' && detail.stage !== definition.stage) {
        context.addIssue({
          code: 'custom',
          path: ['stage'],
          message: `Expected stage ${definition.stage} for ${detail.eventCode}.`,
        });
      }
      if (detail.outcome !== definition.outcome) {
        context.addIssue({
          code: 'custom',
          path: ['outcome'],
          message: `Expected outcome ${definition.outcome} for ${detail.eventCode}.`,
        });
      }
    }
    if (
      detail.kind === 'evidence' &&
      ((detail.eventCode === 'evidence_excerpt_opened' && detail.result !== 'opened') ||
        (detail.eventCode === 'evidence_excerpt_denied' && detail.result !== 'denied'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: `Expected result derived from ${detail.eventCode}.`,
      });
    }
  });

export type OperationalAuditDetail = z.infer<typeof operationalAuditDetailSchema>;
export type OperationalAuditEventCode = OperationalAuditDetail['eventCode'];
export type OperationalAuditLevel = z.infer<typeof operationalAuditLevelSchema>;
export type OperationalAuditOrigin = z.infer<typeof operationalAuditOriginSchema>;
export type OperationalAuditModule = z.infer<typeof operationalAuditModuleSchema>;

type AuditDefinition = Readonly<{
  level: OperationalAuditLevel;
  module: OperationalAuditModule;
  origin: OperationalAuditOrigin;
  message: string;
}>;

export const operationalAuditDefinitionByCode = {
  import_started: {
    level: 'info',
    module: 'import',
    origin: 'desktop',
    message: 'Importação iniciada.',
  },
  import_completed: {
    level: 'info',
    module: 'import',
    origin: 'desktop',
    message: 'Importação concluída.',
  },
  import_failed: {
    level: 'error',
    module: 'import',
    origin: 'desktop',
    message: 'Importação falhou.',
  },
  pipeline_cancelled: {
    level: 'warn',
    module: 'import',
    origin: 'desktop',
    message: 'Execução cancelada.',
  },
  extraction_completed: {
    level: 'info',
    module: 'extraction',
    origin: 'desktop',
    message: 'Extração concluída.',
  },
  extraction_failed: {
    level: 'error',
    module: 'extraction',
    origin: 'desktop',
    message: 'Extração falhou.',
  },
  parsing_completed: {
    level: 'info',
    module: 'parser',
    origin: 'desktop',
    message: 'Parsing concluído.',
  },
  parsing_failed: {
    level: 'error',
    module: 'parser',
    origin: 'desktop',
    message: 'Parsing falhou.',
  },
  identification_completed: {
    level: 'info',
    module: 'block_id',
    origin: 'desktop',
    message: 'Identificação concluída.',
  },
  identification_failed: {
    level: 'error',
    module: 'block_id',
    origin: 'desktop',
    message: 'Identificação falhou.',
  },
  validation_completed: {
    level: 'info',
    module: 'validation',
    origin: 'desktop',
    message: 'Validação concluída.',
  },
  validation_blocked: {
    level: 'warn',
    module: 'validation',
    origin: 'desktop',
    message: 'Validação encontrou bloqueios.',
  },
  validation_failed: {
    level: 'error',
    module: 'validation',
    origin: 'desktop',
    message: 'Validação falhou.',
  },
  export_completed: {
    level: 'info',
    module: 'export',
    origin: 'desktop',
    message: 'Exportação concluída.',
  },
  export_failed: {
    level: 'error',
    module: 'export',
    origin: 'desktop',
    message: 'Exportação falhou.',
  },
  publication_approval_recorded: {
    level: 'info',
    module: 'publication',
    origin: 'publisher',
    message: 'Aprovação de publicação registrada.',
  },
  publication_pushed: {
    level: 'info',
    module: 'publication',
    origin: 'publisher',
    message: 'Candidato de publicação enviado.',
  },
  publication_syncing: {
    level: 'info',
    module: 'publication',
    origin: 'publisher',
    message: 'Sincronização da publicação iniciada.',
  },
  publication_published: {
    level: 'info',
    module: 'publication',
    origin: 'publisher',
    message: 'Publicação confirmada.',
  },
  publication_failed: {
    level: 'error',
    module: 'publication',
    origin: 'publisher',
    message: 'Publicação falhou.',
  },
  legislative_update_created: {
    level: 'info',
    module: 'legislative_update',
    origin: 'update_worker',
    message: 'Atualização legislativa criada.',
  },
  legislative_update_detected_again: {
    level: 'info',
    module: 'legislative_update',
    origin: 'update_worker',
    message: 'Atualização legislativa detectada novamente.',
  },
  legislative_update_superseded: {
    level: 'info',
    module: 'legislative_update',
    origin: 'update_worker',
    message: 'Atualização legislativa substituída.',
  },
  legislative_update_approved: {
    level: 'info',
    module: 'legislative_update',
    origin: 'update_worker',
    message: 'Atualização legislativa aprovada.',
  },
  legislative_update_rejected: {
    level: 'warn',
    module: 'legislative_update',
    origin: 'update_worker',
    message: 'Atualização legislativa rejeitada.',
  },
  legislative_update_error_recorded: {
    level: 'error',
    module: 'legislative_update',
    origin: 'update_worker',
    message: 'Falha de atualização legislativa registrada.',
  },
  legislative_update_reprocess_requested: {
    level: 'info',
    module: 'legislative_update',
    origin: 'update_worker',
    message: 'Reprocessamento legislativo solicitado.',
  },
  legislative_update_reprocess_claimed: {
    level: 'info',
    module: 'legislative_update',
    origin: 'update_worker',
    message: 'Reprocessamento legislativo assumido.',
  },
  source_catalog_provider_revision_created: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Revisão de provedor criada.',
  },
  source_catalog_binding_revision_created: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Revisão de vínculo criada.',
  },
  source_catalog_test_recorded: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Teste de fonte registrado.',
  },
  source_catalog_binding_activated: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Vínculo de fonte ativado.',
  },
  source_catalog_binding_paused: {
    level: 'warn',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Vínculo de fonte pausado.',
  },
  source_catalog_binding_archived: {
    level: 'warn',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Vínculo de fonte arquivado.',
  },
  source_catalog_binding_restored: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Vínculo de fonte restaurado.',
  },
  source_check_requested: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Verificação de fonte solicitada.',
  },
  source_check_claimed: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Verificação de fonte assumida.',
  },
  source_check_completed: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Verificação de fonte concluída.',
  },
  source_check_failed: {
    level: 'error',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Verificação de fonte falhou.',
  },
  source_check_cancelled: {
    level: 'warn',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Verificação de fonte cancelada.',
  },
  source_check_health_degraded: {
    level: 'warn',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Saúde da fonte degradada.',
  },
  source_check_health_suspended: {
    level: 'error',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Verificação da fonte suspensa.',
  },
  source_check_health_recovered: {
    level: 'info',
    module: 'source_catalog',
    origin: 'source_catalog',
    message: 'Saúde da fonte recuperada.',
  },
  audit_journal_integrity_failed: {
    level: 'error',
    module: 'audit_integrity',
    origin: 'desktop',
    message: 'Integridade do diário de auditoria falhou.',
  },
  audit_journal_opened: {
    level: 'info',
    module: 'audit_integrity',
    origin: 'desktop',
    message: 'Diário de auditoria verificado.',
  },
  reprocess_requested: {
    level: 'info',
    module: 'reprocessing',
    origin: 'desktop',
    message: 'Reprocessamento solicitado.',
  },
  reprocess_started: {
    level: 'info',
    module: 'reprocessing',
    origin: 'desktop',
    message: 'Reprocessamento iniciado.',
  },
  reprocess_conflicted: {
    level: 'warn',
    module: 'reprocessing',
    origin: 'desktop',
    message: 'Reprocessamento encontrou conflito.',
  },
  reprocess_completed: {
    level: 'info',
    module: 'reprocessing',
    origin: 'desktop',
    message: 'Reprocessamento concluído.',
  },
  reprocess_failed: {
    level: 'error',
    module: 'reprocessing',
    origin: 'desktop',
    message: 'Reprocessamento falhou.',
  },
  reprocess_cancelled: {
    level: 'warn',
    module: 'reprocessing',
    origin: 'desktop',
    message: 'Reprocessamento cancelado.',
  },
  evidence_excerpt_opened: {
    level: 'info',
    module: 'evidence',
    origin: 'desktop',
    message: 'Trecho de evidência aberto.',
  },
  evidence_excerpt_denied: {
    level: 'warn',
    module: 'evidence',
    origin: 'desktop',
    message: 'Acesso ao trecho de evidência negado.',
  },
  incident_note_recorded: {
    level: 'info',
    module: 'incident',
    origin: 'desktop',
    message: 'Nota de causa raiz registrada para o incidente.',
  },
} as const satisfies Record<OperationalAuditEventCode, AuditDefinition>;

const actorSchema = z.strictObject({
  actorId: nullableUuidSchema,
  actorRole: operationalAuditActorRoleSchema,
});

const eventObjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: uuidSchema,
  occurredAt: timestampSchema,
  level: operationalAuditLevelSchema,
  module: operationalAuditModuleSchema,
  origin: operationalAuditOriginSchema,
  message: z
    .string()
    .min(1)
    .max(512)
    .refine((value) => !containsSensitiveAuditText(value)),
  correlationId: uuidSchema,
  actor: actorSchema,
  lawId: nullableUuidSchema,
  projectId: nullableUuidSchema,
  runId: nullableUuidSchema,
  incidentId: nullableUuidSchema,
  detail: operationalAuditDetailSchema,
});

export const operationalAuditEventSchema = eventObjectSchema.superRefine((event, context) => {
  const definition = operationalAuditDefinitionByCode[event.detail.eventCode];
  for (const [path, received, expected] of [
    ['level', event.level, definition.level],
    ['module', event.module, definition.module],
    ['origin', event.origin, definition.origin],
    ['message', event.message, definition.message],
  ] as const) {
    if (received !== expected) {
      context.addIssue({
        code: 'custom',
        path: [path],
        message: `Expected derived ${path} for ${event.detail.eventCode}.`,
      });
    }
  }
  if (event.origin === 'desktop' && event.projectId === null) {
    context.addIssue({
      code: 'custom',
      path: ['projectId'],
      message: 'Desktop event requires projectId.',
    });
  }
  if (event.detail.kind === 'incident' && event.incidentId === null) {
    context.addIssue({
      code: 'custom',
      path: ['incidentId'],
      message: 'Incident note requires an incidentId.',
    });
  }
});

export type OperationalAuditEvent = z.infer<typeof operationalAuditEventSchema>;
export type CreateOperationalAuditEventInput = Omit<
  OperationalAuditEvent,
  'schemaVersion' | 'level' | 'module' | 'origin' | 'message'
>;

export const createOperationalAuditEvent = (
  input: CreateOperationalAuditEventInput,
): OperationalAuditEvent => {
  const definition = operationalAuditDefinitionByCode[input.detail.eventCode];
  return operationalAuditEventSchema.parse({
    schemaVersion: 1,
    ...input,
    level: definition.level,
    module: definition.module,
    origin: definition.origin,
    message: definition.message,
  });
};

export const safeOperationalAuditProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: uuidSchema,
  occurredAt: timestampSchema,
  level: operationalAuditLevelSchema,
  module: operationalAuditModuleSchema,
  origin: operationalAuditOriginSchema,
  eventCode: z.enum(
    Object.keys(operationalAuditDefinitionByCode) as [
      OperationalAuditEventCode,
      ...OperationalAuditEventCode[],
    ],
  ),
  message: z.string().min(1).max(512),
  correlationId: uuidSchema,
  actorRole: operationalAuditActorRoleSchema,
  lawId: nullableUuidSchema,
  projectId: nullableUuidSchema,
  runId: nullableUuidSchema,
  incidentId: nullableUuidSchema,
  hasEvidence: z.boolean(),
});

export type SafeOperationalAuditProjection = z.infer<typeof safeOperationalAuditProjectionSchema>;

export const projectSafeOperationalAuditEvent = (
  candidate: unknown,
): SafeOperationalAuditProjection => {
  const event = operationalAuditEventSchema.parse(candidate);
  return safeOperationalAuditProjectionSchema.parse({
    schemaVersion: 1,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    level: event.level,
    module: event.module,
    origin: event.origin,
    eventCode: event.detail.eventCode,
    message: event.message,
    correlationId: event.correlationId,
    actorRole: event.actor.actorRole,
    lawId: event.lawId,
    projectId: event.projectId,
    runId: event.runId,
    incidentId: event.incidentId,
    hasEvidence: event.detail.kind === 'pipeline' && event.detail.evidence !== null,
  });
};
