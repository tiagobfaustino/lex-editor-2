import {
  sourceRoleSchema,
  sourceVariantSchema,
  type SourceRole,
  type SourceVariant,
} from '@lex-editor/legal-domain';
import { z } from 'zod';

export const sourceCatalogUuidSchema = z.uuid();
export const sourceCatalogDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const sourceCatalogTimestampSchema = z.iso.datetime({ offset: true });

export const sourceActivationStateSchema = z.enum(['draft', 'active', 'paused', 'archived']);
export const sourceHealthStateSchema = z.enum(['unknown', 'healthy', 'degraded', 'suspended']);
export const officialRemoteSourceTypeSchema = z.enum(['planalto_html', 'lexml_xml']);
export const sourceOriginSchemeSchema = z.enum(['http', 'https']);

const sourceProviderKeySchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const sourceAdapterIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const normalizedHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u,
  )
  .refine((host) => !host.includes('*'), 'Host curinga não é permitido.');
const normalizedPathPrefixSchema = z
  .string()
  .min(1)
  .max(1_024)
  .startsWith('/')
  .refine((path) => !path.includes('?') && !path.includes('#'), 'Prefixo deve conter apenas path.');

export const sourceOriginSchema = z.strictObject({
  scheme: sourceOriginSchemeSchema,
  host: normalizedHostSchema,
  port: z.int().min(1).max(65_535).nullable(),
  pathPrefix: normalizedPathPrefixSchema,
});

const detectionParameterKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$/u);
const detectionParameterValueSchema = z.union([
  z.string().max(500),
  z.boolean(),
  z.int().min(-1_000_000).max(1_000_000),
]);

export const sourceDetectionParametersSchema = z
  .record(detectionParameterKeySchema, detectionParameterValueSchema)
  .superRefine((parameters, context) => {
    if (Object.keys(parameters).length > 32) {
      context.addIssue({ code: 'custom', message: 'No máximo 32 parâmetros são permitidos.' });
    }
  });

export const sourceProviderSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: sourceCatalogUuidSchema,
  providerKey: sourceProviderKeySchema,
  activeProviderRevisionId: sourceCatalogUuidSchema.nullable(),
  sourceActivationState: sourceActivationStateSchema,
  lockVersion: z.int().nonnegative(),
});

export const providerRevisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providerRevisionId: sourceCatalogUuidSchema,
  providerId: sourceCatalogUuidSchema,
  revisionNumber: z.int().positive(),
  providerKey: sourceProviderKeySchema,
  providerName: z.string().trim().min(3).max(160),
  sourceType: officialRemoteSourceTypeSchema,
  adapterId: sourceAdapterIdSchema,
  adapterContractVersion: z.int().positive().max(1_000_000),
  origin: sourceOriginSchema,
  detectionParameters: sourceDetectionParametersSchema,
  configDigest: sourceCatalogDigestSchema,
  createdByUserId: sourceCatalogUuidSchema,
  createdAt: sourceCatalogTimestampSchema,
});

export const lawSourceArtifactSchema = z.strictObject({
  order: z.int().nonnegative(),
  sourceRole: sourceRoleSchema,
  sourceVariant: sourceVariantSchema,
  sourceUrl: z.url().max(2_048),
});

export const lawSourceBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bindingId: sourceCatalogUuidSchema,
  lawId: sourceCatalogUuidSchema,
  activeBindingRevisionId: sourceCatalogUuidSchema.nullable(),
  sourceActivationState: sourceActivationStateSchema,
  lockVersion: z.int().nonnegative(),
});

export const lawSourceBindingRevisionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    bindingRevisionId: sourceCatalogUuidSchema,
    bindingId: sourceCatalogUuidSchema,
    lawId: sourceCatalogUuidSchema,
    providerRevisionId: sourceCatalogUuidSchema,
    revisionNumber: z.int().positive(),
    artifacts: z.array(lawSourceArtifactSchema).min(1).max(10),
    monitoringIntervalMs: z
      .int()
      .min(60 * 60 * 1_000)
      .max(31 * 24 * 60 * 60 * 1_000),
    configDigest: sourceCatalogDigestSchema,
    createdByUserId: sourceCatalogUuidSchema,
    createdAt: sourceCatalogTimestampSchema,
  })
  .superRefine((revision, context) => {
    const primaryCount = revision.artifacts.filter(
      ({ sourceRole }) => sourceRole === 'primary_current',
    ).length;
    if (primaryCount !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'O conjunto deve ter exatamente uma fonte primary_current.',
      });
    }

    const urls = new Set<string>();
    const orders = new Set<number>();
    for (const [index, artifact] of revision.artifacts.entries()) {
      if (urls.has(artifact.sourceUrl)) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', index, 'sourceUrl'],
          message: 'URL duplicada no conjunto de fontes.',
        });
      }
      if (orders.has(artifact.order)) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', index, 'order'],
          message: 'Ordem duplicada no conjunto de fontes.',
        });
      }
      urls.add(artifact.sourceUrl);
      orders.add(artifact.order);
    }
  });

export const activeSourceImportConfigurationSchema = z.strictObject({
  providerRevision: providerRevisionSchema,
  bindingRevision: lawSourceBindingRevisionSchema,
});

export const sourceConfigurationEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: sourceCatalogUuidSchema,
  providerRevisionId: sourceCatalogUuidSchema,
  providerConfigDigest: sourceCatalogDigestSchema,
  bindingId: sourceCatalogUuidSchema,
  bindingRevisionId: sourceCatalogUuidSchema,
  bindingConfigDigest: sourceCatalogDigestSchema,
  adapterId: sourceAdapterIdSchema,
  adapterContractVersion: z.int().positive().max(1_000_000),
});

export const sourceTestOutcomeSchema = z.enum(['success', 'failure']);
export const sourceTestStageSchema = z.enum(['policy', 'network', 'detection', 'adapter']);
export const sourceCheckTriggerSchema = z.enum(['scheduled', 'manual']);
export const sourceCheckJobStateSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const sourceTestEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    testEvidenceId: sourceCatalogUuidSchema,
    providerRevisionId: sourceCatalogUuidSchema,
    bindingRevisionId: sourceCatalogUuidSchema,
    providerConfigDigest: sourceCatalogDigestSchema,
    bindingConfigDigest: sourceCatalogDigestSchema,
    adapterId: sourceAdapterIdSchema,
    adapterContractVersion: z.int().positive().max(1_000_000),
    sourceTestOutcome: sourceTestOutcomeSchema,
    completedStage: sourceTestStageSchema,
    evidenceDigest: sourceCatalogDigestSchema,
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,79}$/u)
      .nullable(),
    testedByUserId: sourceCatalogUuidSchema,
    testedAt: sourceCatalogTimestampSchema,
  })
  .superRefine((evidence, context) => {
    if (evidence.sourceTestOutcome === 'success' && evidence.errorCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'Teste bem-sucedido não possui código de erro.',
      });
    }
    if (evidence.sourceTestOutcome === 'failure' && evidence.errorCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'Teste falho exige código de erro.',
      });
    }
  });

export const sourceBindingHealthSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    bindingId: sourceCatalogUuidSchema,
    bindingRevisionId: sourceCatalogUuidSchema,
    sourceHealthState: sourceHealthStateSchema,
    nextCheckAt: sourceCatalogTimestampSchema,
    consecutiveFailures: z.int().nonnegative(),
    nextRetryAt: sourceCatalogTimestampSchema.nullable(),
    suspendedUntil: sourceCatalogTimestampSchema.nullable(),
    lastErrorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,79}$/u)
      .nullable(),
    lastCheckedAt: sourceCatalogTimestampSchema.nullable(),
    updatedAt: sourceCatalogTimestampSchema,
  })
  .superRefine((health, context) => {
    const isClean =
      health.consecutiveFailures === 0 &&
      health.nextRetryAt === null &&
      health.suspendedUntil === null &&
      health.lastErrorCode === null;
    const isFailure =
      health.consecutiveFailures > 0 &&
      health.nextRetryAt !== null &&
      health.lastErrorCode !== null;
    const valid =
      (health.sourceHealthState === 'unknown' && isClean && health.lastCheckedAt === null) ||
      (health.sourceHealthState === 'healthy' && isClean && health.lastCheckedAt !== null) ||
      (health.sourceHealthState === 'degraded' && isFailure && health.suspendedUntil === null) ||
      (health.sourceHealthState === 'suspended' && isFailure && health.suspendedUntil !== null);
    if (!valid) {
      context.addIssue({
        code: 'custom',
        message: 'Saúde da fonte possui estado, falhas, retry ou suspensão inconsistentes.',
      });
    }
  });

export const activeLawSourceBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bindingId: sourceCatalogUuidSchema,
  bindingRevisionId: sourceCatalogUuidSchema,
  lawId: sourceCatalogUuidSchema,
  providerRevisionId: sourceCatalogUuidSchema,
  monitoringIntervalMs: z
    .int()
    .min(60 * 60 * 1_000)
    .max(31 * 24 * 60 * 60 * 1_000),
  sourceActivationState: z.literal('active'),
  sourceHealthState: sourceHealthStateSchema,
  nextCheckAt: sourceCatalogTimestampSchema,
  artifacts: z.array(lawSourceArtifactSchema).min(1).max(10),
});

export const capturedSourceCheckJobSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sourceCheckJobId: sourceCatalogUuidSchema,
    bindingId: sourceCatalogUuidSchema,
    bindingRevisionId: sourceCatalogUuidSchema,
    providerRevisionId: sourceCatalogUuidSchema,
    lawId: sourceCatalogUuidSchema,
    baseVersionId: sourceCatalogUuidSchema,
    sourceCheckTrigger: sourceCheckTriggerSchema,
    sourceCheckJobState: z.literal('running'),
    idempotencyKey: z.string().trim().min(1).max(200),
    requestedAt: sourceCatalogTimestampSchema,
    claimedAt: sourceCatalogTimestampSchema,
    providerRevision: providerRevisionSchema,
    bindingRevision: lawSourceBindingRevisionSchema,
    health: sourceBindingHealthSchema,
  })
  .superRefine((job, context) => {
    if (
      job.bindingId !== job.bindingRevision.bindingId ||
      job.bindingRevisionId !== job.bindingRevision.bindingRevisionId ||
      job.providerRevisionId !== job.providerRevision.providerRevisionId ||
      job.providerRevisionId !== job.bindingRevision.providerRevisionId ||
      job.lawId !== job.bindingRevision.lawId ||
      job.bindingId !== job.health.bindingId ||
      job.bindingRevisionId !== job.health.bindingRevisionId
    ) {
      context.addIssue({ code: 'custom', message: 'Job capturou revisões inconsistentes.' });
    }
  });

export const sourceCheckRequestResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceCheckJobId: sourceCatalogUuidSchema,
  bindingId: sourceCatalogUuidSchema,
  bindingRevisionId: sourceCatalogUuidSchema,
  providerRevisionId: sourceCatalogUuidSchema,
  lawId: sourceCatalogUuidSchema,
  baseVersionId: sourceCatalogUuidSchema,
  sourceCheckTrigger: sourceCheckTriggerSchema,
  sourceCheckJobState: z.enum(['queued', 'running']),
  idempotencyKey: z.string().trim().min(1).max(200),
  requestedAt: sourceCatalogTimestampSchema,
  deduplicated: z.boolean(),
});

export const sourceCheckCompletionSchema = z
  .strictObject({
    sourceCheckJobId: sourceCatalogUuidSchema,
    sourceCheckJobState: z.enum(['completed', 'failed']),
    detailCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,79}$/u)
      .nullable(),
    completedAt: sourceCatalogTimestampSchema,
    health: sourceBindingHealthSchema,
  })
  .superRefine((completion, context) => {
    const completed =
      completion.sourceCheckJobState === 'completed' &&
      completion.detailCode === null &&
      completion.health.sourceHealthState === 'healthy';
    const failed =
      completion.sourceCheckJobState === 'failed' &&
      completion.detailCode !== null &&
      ['degraded', 'suspended'].includes(completion.health.sourceHealthState);
    if (!completed && !failed) {
      context.addIssue({
        code: 'custom',
        message: 'Conclusão e saúde da verificação são inconsistentes.',
      });
    }
  });

export const sourceCheckCompletionResultSchema = z.strictObject({
  sourceCheckJobId: sourceCatalogUuidSchema,
  sourceCheckJobState: z.enum(['completed', 'failed']),
  healthApplied: z.boolean(),
});

export const sourceCatalogEventTypeSchema = z.enum([
  'provider_revision_created',
  'binding_revision_created',
  'test_recorded',
  'binding_activated',
  'binding_paused',
  'binding_archived',
  'binding_restored',
]);
export const sourceCatalogEntityTypeSchema = z.enum(['provider', 'binding']);

export const sourceCatalogEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: z.bigint().positive(),
  sourceCatalogEventType: sourceCatalogEventTypeSchema,
  sourceCatalogEntityType: sourceCatalogEntityTypeSchema,
  entityId: sourceCatalogUuidSchema,
  providerRevisionId: sourceCatalogUuidSchema.nullable(),
  bindingRevisionId: sourceCatalogUuidSchema.nullable(),
  previousRevisionId: sourceCatalogUuidSchema.nullable(),
  actorUserId: sourceCatalogUuidSchema,
  detailCode: z.string().trim().min(1).max(80).nullable(),
  occurredAt: sourceCatalogTimestampSchema,
});

export type SourceActivationState = z.infer<typeof sourceActivationStateSchema>;
export type SourceHealthState = z.infer<typeof sourceHealthStateSchema>;
export type SourceOrigin = z.infer<typeof sourceOriginSchema>;
export type SourceProvider = z.infer<typeof sourceProviderSchema>;
export type ProviderRevision = z.infer<typeof providerRevisionSchema>;
export type LawSourceArtifact = z.infer<typeof lawSourceArtifactSchema>;
export type LawSourceBinding = z.infer<typeof lawSourceBindingSchema>;
export type LawSourceBindingRevision = z.infer<typeof lawSourceBindingRevisionSchema>;
export type ActiveSourceImportConfiguration = z.infer<typeof activeSourceImportConfigurationSchema>;
export type SourceConfigurationEvidence = z.infer<typeof sourceConfigurationEvidenceSchema>;
export type SourceTestEvidence = z.infer<typeof sourceTestEvidenceSchema>;
export type SourceBindingHealth = z.infer<typeof sourceBindingHealthSchema>;
export type ActiveLawSourceBinding = z.infer<typeof activeLawSourceBindingSchema>;
export type SourceCheckTrigger = z.infer<typeof sourceCheckTriggerSchema>;
export type SourceCheckJobState = z.infer<typeof sourceCheckJobStateSchema>;
export type CapturedSourceCheckJob = z.infer<typeof capturedSourceCheckJobSchema>;
export type SourceCheckRequestResult = z.infer<typeof sourceCheckRequestResultSchema>;
export type SourceCheckCompletion = z.infer<typeof sourceCheckCompletionSchema>;
export type SourceCheckCompletionResult = z.infer<typeof sourceCheckCompletionResultSchema>;
export type SourceCatalogEvent = z.infer<typeof sourceCatalogEventSchema>;

export type { SourceRole, SourceVariant };
