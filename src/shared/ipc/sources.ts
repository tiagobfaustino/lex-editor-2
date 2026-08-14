import { z } from 'zod';
import { sourceAdapterCapabilitiesSchema } from '@lex-editor/source-ingestion';

import { DesktopErrorDtoSchema } from './desktop-api.js';

export const SOURCES_LIST_CHANNEL = 'sources:list' as const;
export const SOURCES_CREATE_PROVIDER_REVISION_CHANNEL = 'sources:create-provider-revision' as const;
export const SOURCES_CREATE_BINDING_REVISION_CHANNEL = 'sources:create-binding-revision' as const;
export const SOURCES_DRY_RUN_CHANNEL = 'sources:dry-run' as const;
export const SOURCES_ACTIVATE_CHANNEL = 'sources:activate' as const;
export const SOURCES_PAUSE_CHANNEL = 'sources:pause' as const;
export const SOURCES_ARCHIVE_CHANNEL = 'sources:archive' as const;
export const SOURCES_RESTORE_CHANNEL = 'sources:restore' as const;
export const SOURCES_REQUEST_CHECK_CHANNEL = 'sources:request-check' as const;

export const DESKTOP_SOURCE_CATALOG_LIMITS = Object.freeze({
  commandBytes: 16 * 1_024,
  actionResultBytes: 16 * 1_024,
  pageResultBytes: 256 * 1_024,
  maxPageItems: 50,
  maxArtifacts: 10,
});

const uuidSchema = z.uuid();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const sourceActivationStateSchema = z.enum(['draft', 'active', 'paused', 'archived']);
const sourceHealthStateSchema = z.enum(['unknown', 'healthy', 'degraded', 'suspended']);
const sourceTestOutcomeSchema = z.enum(['success', 'failure']);
const sourceTestStageSchema = z.enum(['policy', 'network', 'detection', 'adapter']);
const adapterIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const providerKeySchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const SourceArtifactIntentSchema = z.strictObject({
  order: z.int().nonnegative().max(1_000_000),
  sourceRole: z.enum(['primary_current', 'historical_auxiliary', 'cross_check']),
  sourceVariant: z.enum(['compiled', 'annotated', 'other']),
  sourceUrl: z.url().max(2_048),
});

const sourceOriginIntentSchema = z.strictObject({
  scheme: z.enum(['http', 'https']),
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(
      /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u,
    ),
  port: z.int().min(1).max(65_535).nullable(),
  pathPrefix: z
    .string()
    .min(1)
    .max(1_024)
    .startsWith('/')
    .refine((path) => !path.includes('?') && !path.includes('#')),
});

const detectionValueSchema = z.union([
  z.string().max(500),
  z.boolean(),
  z.int().min(-1_000_000).max(1_000_000),
]);
const detectionParametersIntentSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$/u),
    detectionValueSchema,
  )
  .refine((value) => Object.keys(value).length <= 32);

export const ListSourceCatalogCommandSchema = z.strictObject({
  cursor: uuidSchema.nullable(),
  limit: z.int().min(1).max(DESKTOP_SOURCE_CATALOG_LIMITS.maxPageItems),
});

export const CreateSourceProviderRevisionCommandSchema = z.strictObject({
  providerId: uuidSchema.optional(),
  providerKey: providerKeySchema,
  expectedLockVersion: z.int().nonnegative(),
  providerName: z.string().trim().min(3).max(160),
  sourceType: z.enum(['planalto_html', 'lexml_xml']),
  adapterId: adapterIdSchema,
  adapterContractVersion: z.int().positive().max(1_000_000),
  origin: sourceOriginIntentSchema,
  detectionParameters: detectionParametersIntentSchema,
});

export const CreateLawSourceBindingRevisionCommandSchema = z
  .strictObject({
    bindingId: uuidSchema.optional(),
    lawId: uuidSchema,
    providerRevisionId: uuidSchema,
    expectedLockVersion: z.int().nonnegative(),
    artifacts: z
      .array(SourceArtifactIntentSchema)
      .min(1)
      .max(DESKTOP_SOURCE_CATALOG_LIMITS.maxArtifacts),
    monitoringIntervalMs: z
      .int()
      .min(60 * 60 * 1_000)
      .max(31 * 24 * 60 * 60 * 1_000),
  })
  .superRefine((value, context) => {
    if (value.artifacts.filter(({ sourceRole }) => sourceRole === 'primary_current').length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Fonte primária inválida.',
      });
    }
    const orders = new Set<number>();
    const urls = new Set<string>();
    for (const [index, artifact] of value.artifacts.entries()) {
      if (orders.has(artifact.order) || urls.has(artifact.sourceUrl)) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', index],
          message: 'Artefato duplicado.',
        });
      }
      orders.add(artifact.order);
      urls.add(artifact.sourceUrl);
    }
  });

export const DryRunSourceBindingCommandSchema = z.strictObject({
  providerRevisionId: uuidSchema,
  bindingRevisionId: uuidSchema,
});

export const ActivateSourceBindingCommandSchema = z.strictObject({
  providerId: uuidSchema,
  providerRevisionId: uuidSchema,
  expectedProviderLockVersion: z.int().nonnegative(),
  bindingId: uuidSchema,
  bindingRevisionId: uuidSchema,
  expectedBindingLockVersion: z.int().nonnegative(),
  testEvidenceId: uuidSchema,
});

export const ChangeSourceBindingActivationCommandSchema = z.strictObject({
  bindingId: uuidSchema,
  expectedBindingLockVersion: z.int().nonnegative(),
});

export const RequestSourceCheckCommandSchema = z.strictObject({
  bindingId: uuidSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const SourceCatalogListItemDtoSchema = z.strictObject({
  providerId: uuidSchema,
  providerRevisionId: uuidSchema,
  providerRevisionNumber: z.int().positive(),
  providerKey: providerKeySchema,
  providerName: z.string().min(3).max(160),
  adapterId: adapterIdSchema,
  adapterContractVersion: z.int().positive().max(1_000_000),
  providerLockVersion: z.int().nonnegative(),
  bindingId: uuidSchema,
  bindingRevisionId: uuidSchema,
  bindingRevisionNumber: z.int().positive(),
  bindingLockVersion: z.int().nonnegative(),
  lawId: uuidSchema,
  lawTitle: z.string().min(1).max(500),
  sourceActivationState: sourceActivationStateSchema,
  sourceHealthState: sourceHealthStateSchema,
  monitoringIntervalMs: z.int().positive(),
  lastSourceTestOutcome: sourceTestOutcomeSchema.nullable(),
  lastTestEvidenceId: uuidSchema.nullable(),
  lastTestedAt: timestampSchema.nullable(),
  lastCheckedAt: timestampSchema.nullable(),
  lastErrorCode: z.string().min(3).max(80).nullable(),
  artifacts: z
    .array(SourceArtifactIntentSchema)
    .min(1)
    .max(DESKTOP_SOURCE_CATALOG_LIMITS.maxArtifacts),
});

export const SourceCatalogPageDtoSchema = z.strictObject({
  items: z.array(SourceCatalogListItemDtoSchema).max(DESKTOP_SOURCE_CATALOG_LIMITS.maxPageItems),
  nextCursor: uuidSchema.nullable(),
  adapterCapabilities: z.array(sourceAdapterCapabilitiesSchema).max(20),
});

export const CreatedSourceProviderRevisionDtoSchema = z.strictObject({
  providerId: uuidSchema,
  providerRevisionId: uuidSchema,
  revisionNumber: z.int().positive(),
  providerLockVersion: z.int().nonnegative(),
});

export const CreatedLawSourceBindingRevisionDtoSchema = z.strictObject({
  bindingId: uuidSchema,
  bindingRevisionId: uuidSchema,
  revisionNumber: z.int().positive(),
  bindingLockVersion: z.int().nonnegative(),
});

export const SourceDryRunDtoSchema = z.strictObject({
  testEvidenceId: uuidSchema,
  providerRevisionId: uuidSchema,
  bindingRevisionId: uuidSchema,
  sourceTestOutcome: sourceTestOutcomeSchema,
  completedStage: sourceTestStageSchema,
  evidenceDigest: digestSchema,
  errorCode: z.string().min(3).max(80).nullable(),
  testedAt: timestampSchema,
});

export const ActivatedSourceBindingDtoSchema = z.strictObject({
  providerId: uuidSchema,
  providerRevisionId: uuidSchema,
  providerLockVersion: z.int().nonnegative(),
  bindingId: uuidSchema,
  bindingRevisionId: uuidSchema,
  bindingLockVersion: z.int().nonnegative(),
  sourceActivationState: z.literal('active'),
});

export const ChangedSourceBindingActivationDtoSchema = z.strictObject({
  bindingId: uuidSchema,
  bindingRevisionId: uuidSchema.nullable(),
  bindingLockVersion: z.int().nonnegative(),
  sourceActivationState: z.enum(['paused', 'archived']),
});

export const RequestedSourceCheckDtoSchema = z.strictObject({
  sourceCheckJobId: uuidSchema,
  bindingId: uuidSchema,
  bindingRevisionId: uuidSchema,
  sourceCheckJobState: z.enum(['queued', 'running']),
  requestedAt: timestampSchema,
  deduplicated: z.boolean(),
});

const resultSchema = <Value extends z.ZodType>(valueSchema: Value) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: valueSchema }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);

export const ListSourceCatalogResultSchema = resultSchema(SourceCatalogPageDtoSchema);
export const CreateSourceProviderRevisionResultSchema = resultSchema(
  CreatedSourceProviderRevisionDtoSchema,
);
export const CreateLawSourceBindingRevisionResultSchema = resultSchema(
  CreatedLawSourceBindingRevisionDtoSchema,
);
export const DryRunSourceBindingResultSchema = resultSchema(SourceDryRunDtoSchema);
export const ActivateSourceBindingResultSchema = resultSchema(ActivatedSourceBindingDtoSchema);
export const ChangeSourceBindingActivationResultSchema = resultSchema(
  ChangedSourceBindingActivationDtoSchema,
);
export const RequestSourceCheckResultSchema = resultSchema(RequestedSourceCheckDtoSchema);

export type ListSourceCatalogCommand = z.infer<typeof ListSourceCatalogCommandSchema>;
export type CreateSourceProviderRevisionCommand = z.infer<
  typeof CreateSourceProviderRevisionCommandSchema
>;
export type CreateLawSourceBindingRevisionCommand = z.infer<
  typeof CreateLawSourceBindingRevisionCommandSchema
>;
export type DryRunSourceBindingCommand = z.infer<typeof DryRunSourceBindingCommandSchema>;
export type ActivateSourceBindingCommand = z.infer<typeof ActivateSourceBindingCommandSchema>;
export type ChangeSourceBindingActivationCommand = z.infer<
  typeof ChangeSourceBindingActivationCommandSchema
>;
export type RequestSourceCheckCommand = z.infer<typeof RequestSourceCheckCommandSchema>;
export type SourceCatalogListItemDto = z.infer<typeof SourceCatalogListItemDtoSchema>;
export type SourceCatalogPageDto = z.infer<typeof SourceCatalogPageDtoSchema>;
export type CreatedSourceProviderRevisionDto = z.infer<
  typeof CreatedSourceProviderRevisionDtoSchema
>;
export type CreatedLawSourceBindingRevisionDto = z.infer<
  typeof CreatedLawSourceBindingRevisionDtoSchema
>;
export type SourceDryRunDto = z.infer<typeof SourceDryRunDtoSchema>;
export type ActivatedSourceBindingDto = z.infer<typeof ActivatedSourceBindingDtoSchema>;
export type ChangedSourceBindingActivationDto = z.infer<
  typeof ChangedSourceBindingActivationDtoSchema
>;
export type RequestedSourceCheckDto = z.infer<typeof RequestedSourceCheckDtoSchema>;
export type ListSourceCatalogResult = z.infer<typeof ListSourceCatalogResultSchema>;
export type CreateSourceProviderRevisionResult = z.infer<
  typeof CreateSourceProviderRevisionResultSchema
>;
export type CreateLawSourceBindingRevisionResult = z.infer<
  typeof CreateLawSourceBindingRevisionResultSchema
>;
export type DryRunSourceBindingResult = z.infer<typeof DryRunSourceBindingResultSchema>;
export type ActivateSourceBindingResult = z.infer<typeof ActivateSourceBindingResultSchema>;
export type ChangeSourceBindingActivationResult = z.infer<
  typeof ChangeSourceBindingActivationResultSchema
>;
export type RequestSourceCheckResult = z.infer<typeof RequestSourceCheckResultSchema>;
