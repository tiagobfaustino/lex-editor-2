import { z } from 'zod';

import { DesktopErrorDtoSchema } from './desktop-api.js';

export const SOURCE_SELECT_LOCAL_CHANNEL = 'source:select-local' as const;
export const SOURCE_IMPORT_URL_CHANNEL = 'source:import-url' as const;
export const PIPELINE_START_CHANNEL = 'pipeline:start' as const;
export const PIPELINE_CANCEL_CHANNEL = 'pipeline:cancel' as const;
export const PIPELINE_PROGRESS_CHANNEL = 'pipeline:progress' as const;
export const PREVIEW_GET_DOCUMENT_CHANNEL = 'preview:get-document' as const;
export const PREVIEW_GET_PAGE_CHANNEL = 'preview:get-page' as const;
export const PREVIEW_REVEAL_NODE_CHANNEL = 'preview:reveal-node' as const;
export const PREVIEW_SET_PROJECTION_PROFILE_CHANNEL = 'preview:set-projection-profile' as const;
export const PREVIEW_GET_LEGAL_REFERENCE_CHANNEL = 'preview:get-legal-reference' as const;
export const PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL = 'preview:navigate-legal-reference' as const;
export const DIAGNOSTICS_GET_PAGE_CHANNEL = 'diagnostics:get-page' as const;
export const EXPORT_CHOOSE_DESTINATION_CHANNEL = 'export:choose-destination' as const;
export const EXPORT_WRITE_CHANNEL = 'export:write' as const;
export const EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL = 'export:choose-batch-destination' as const;
export const EXPORT_WRITE_BATCH_CHANNEL = 'export:write-batch' as const;

/**
 * Limites públicos do contrato desktop. Os handlers ainda aplicam o limite
 * serializado em bytes: cardinalidade e tamanho por campo não o substituem.
 */
export const DESKTOP_IMPORT_LIMITS = Object.freeze({
  commandBytes: 8 * 1024,
  progressEventBytes: 4 * 1024,
  previewDocumentBytes: 64 * 1024,
  previewPageBytes: 512 * 1024,
  diagnosticPageBytes: 128 * 1024,
  sourceResultBytes: 16 * 1024,
  actionResultBytes: 8 * 1024,
  previewPageDefaultItems: 25,
  previewPageMaxItems: 50,
  diagnosticPageDefaultItems: 50,
  diagnosticPageMaxItems: 100,
  maxUrlCharacters: 2_048,
  maxCursorCharacters: 256,
  maxDisplayNameCharacters: 160,
  maxLabelCharacters: 160,
  maxPlainTextCharacters: 8_192,
  maxDiagnosticMessageCharacters: 512,
  maxHistoriesPerNode: 32,
  maxLegalReferencesPerNode: 100,
  maxMetadataEntries: 20,
  maxCallouts: 16,
  maxTreeDepth: 16,
  maxBatchProjects: 100,
} as const);

const BoundedIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const OpaqueIdSchema = z.uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const BlockIdSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const CursorSchema = z
  .string()
  .min(1)
  .max(DESKTOP_IMPORT_LIMITS.maxCursorCharacters)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const SourceKindSchema = z.enum(['local_html', 'local_markdown', 'planalto_url']);

// Enum próprio do contrato IPC: o renderer não importa o domínio jurídico.
export const ContentProjectionProfileDtoSchema = z.enum(['complete_with_history', 'current_only']);

export const SourceSummaryDtoSchema = z.strictObject({
  sourceId: OpaqueIdSchema,
  sourceKind: SourceKindSchema,
  displayName: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
  mediaType: z.enum(['text/html', 'text/markdown']),
  byteLength: BoundedIntegerSchema,
  sourceArtifactSha256: Sha256Schema,
});

export const SelectLocalSourceCommandSchema = z.strictObject({});

export const ImportFromUrlCommandSchema = z.strictObject({
  url: z
    .httpUrl()
    .max(DESKTOP_IMPORT_LIMITS.maxUrlCharacters)
    .refine((value) => {
      const parsed = new URL(value);

      return parsed.username.length === 0 && parsed.password.length === 0;
    }, 'A URL deve usar HTTP(S) e não pode conter credenciais.'),
});

export const StartProcessingCommandSchema = z.strictObject({
  sourceId: OpaqueIdSchema,
});

export const CancelJobCommandSchema = z.strictObject({
  jobId: OpaqueIdSchema,
});

export const GetPreviewDocumentCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
});

export const GetPreviewPageCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  parentPreviewNodeId: OpaqueIdSchema.nullable(),
  cursor: CursorSchema.nullable(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(DESKTOP_IMPORT_LIMITS.previewPageMaxItems)
    .default(DESKTOP_IMPORT_LIMITS.previewPageDefaultItems),
});

export const RevealPreviewNodeCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  previewNodeId: OpaqueIdSchema,
});

export const SetPreviewProjectionProfileCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  projectionProfile: ContentProjectionProfileDtoSchema,
});

export const LegalReferenceCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  referenceId: Sha256Schema,
});

export const GetDiagnosticPageCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  cursor: CursorSchema.nullable(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(DESKTOP_IMPORT_LIMITS.diagnosticPageMaxItems)
    .default(DESKTOP_IMPORT_LIMITS.diagnosticPageDefaultItems),
});

export const ChooseExportDestinationCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  projectionProfile: ContentProjectionProfileDtoSchema,
});

export const WriteExportCommandSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  destinationId: OpaqueIdSchema,
});

export const ChooseBatchExportDestinationCommandSchema = z.strictObject({
  projectIds: z
    .array(OpaqueIdSchema)
    .min(1)
    .max(DESKTOP_IMPORT_LIMITS.maxBatchProjects)
    .refine((values) => new Set(values).size === values.length, 'projectIds deve ser único.'),
});

export const WriteBatchExportCommandSchema = z.strictObject({
  destinationId: OpaqueIdSchema,
});

export const JobAcceptedDtoSchema = z.strictObject({
  jobId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
});

export const CancelJobDtoSchema = z.strictObject({
  jobId: OpaqueIdSchema,
  cancelled: z.boolean(),
});

export const DestinationSummaryDtoSchema = z.strictObject({
  destinationId: OpaqueIdSchema,
  displayName: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
});

export const ExportResultDtoSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  revisionHash: Sha256Schema,
  destinationId: OpaqueIdSchema,
  projectionProfile: ContentProjectionProfileDtoSchema,
  fileName: z
    .string()
    .min(4)
    .max(DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters)
    .regex(/^[^/\\\0]+\.md$/u),
  byteLength: BoundedIntegerSchema,
  markdownSha256: Sha256Schema,
});

export const BatchExportFailureCodeSchema = z.enum([
  'NOT_READY',
  'NOT_APPROVED',
  'DUPLICATE_TARGET',
  'TARGET_CONFLICT',
  'FILESYSTEM_FAILED',
]);

const BatchExportIdentityDtoSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  title: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
  sigla: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
});

export const BatchExportItemResultDtoSchema = z.discriminatedUnion('batchExportStatus', [
  BatchExportIdentityDtoSchema.extend({
    batchExportStatus: z.literal('succeeded'),
    revisionHash: Sha256Schema,
    directoryName: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    markdownFileName: z
      .string()
      .min(4)
      .max(100)
      .regex(/^[a-z0-9-]+\.md$/u),
    updateFileName: z.literal('UPDATE.md'),
    markdownSha256: Sha256Schema,
    updateSha256: Sha256Schema,
  }),
  BatchExportIdentityDtoSchema.extend({
    batchExportStatus: z.literal('failed'),
    errorCode: BatchExportFailureCodeSchema,
  }),
]);

export const BatchExportResultDtoSchema = z
  .strictObject({
    destinationId: OpaqueIdSchema,
    total: z.number().int().min(1).max(DESKTOP_IMPORT_LIMITS.maxBatchProjects),
    succeeded: z.number().int().nonnegative().max(DESKTOP_IMPORT_LIMITS.maxBatchProjects),
    failed: z.number().int().nonnegative().max(DESKTOP_IMPORT_LIMITS.maxBatchProjects),
    results: z.array(BatchExportItemResultDtoSchema).max(DESKTOP_IMPORT_LIMITS.maxBatchProjects),
  })
  .refine(
    ({ total, succeeded, failed, results }) =>
      total === succeeded + failed && total === results.length,
    { message: 'Os totais do lote devem refletir os resultados por lei.', path: ['total'] },
  );

const createResultSchema = <Output extends z.ZodType>(outputSchema: Output) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: outputSchema }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);

export const SelectLocalSourceResultSchema = createResultSchema(SourceSummaryDtoSchema.nullable());
export const ImportFromUrlResultSchema = createResultSchema(SourceSummaryDtoSchema);
export const StartProcessingResultSchema = createResultSchema(JobAcceptedDtoSchema);
export const CancelJobResultSchema = createResultSchema(CancelJobDtoSchema);
export const ChooseExportDestinationResultSchema = createResultSchema(
  DestinationSummaryDtoSchema.nullable(),
);
export const WriteExportResultSchema = createResultSchema(ExportResultDtoSchema);
export const ChooseBatchExportDestinationResultSchema = createResultSchema(
  DestinationSummaryDtoSchema.nullable(),
);
export const WriteBatchExportResultSchema = createResultSchema(BatchExportResultDtoSchema);

export const PipelineJobStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const PipelinePhaseSchema = z.enum([
  'snapshot',
  'extraction',
  'parsing',
  'identification',
  'formatting',
  'preview_projection',
  'export',
]);

export const ProgressDtoSchema = z
  .strictObject({
    jobId: OpaqueIdSchema,
    projectId: OpaqueIdSchema.nullable(),
    sequence: BoundedIntegerSchema,
    jobStatus: PipelineJobStatusSchema,
    phase: PipelinePhaseSchema,
    completedUnits: BoundedIntegerSchema,
    totalUnits: BoundedIntegerSchema.nullable(),
    message: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxLabelCharacters),
  })
  .refine(({ completedUnits, totalUnits }) => totalUnits === null || completedUnits <= totalUnits, {
    message: 'completedUnits não pode exceder totalUnits.',
    path: ['completedUnits'],
  });

export const PreviewMetadataKeySchema = z.enum([
  'title',
  'sigla',
  'tipo',
  'numero',
  'ano',
  'ramo',
  'fonte',
  'data_publicacao',
  'data_atualizacao_legal',
  'data_formatacao_vinculex',
  'total_artigos',
  'versao_vinculex',
  'legal_status',
  'tags',
]);

export const PreviewMetadataEntryDtoSchema = z.strictObject({
  key: PreviewMetadataKeySchema,
  value: z.union([
    z.string().max(2_048),
    z.number().int(),
    z.array(z.string().min(1).max(80)).max(32),
  ]),
});

export const PreviewCalloutDtoSchema = z.strictObject({
  calloutKind: z.enum(['info', 'warning', 'caution', 'note']),
  title: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxLabelCharacters),
  plainText: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxPlainTextCharacters),
});

export const PreviewDocumentDtoSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  revisionHash: Sha256Schema,
  projectionProfile: ContentProjectionProfileDtoSchema,
  source: SourceSummaryDtoSchema,
  title: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
  sigla: z.string().min(1).max(32),
  legalStatus: z.enum([
    'vigente',
    'revogada',
    'alterada',
    'suspensa',
    'sem_eficacia',
    'desconhecida',
  ]),
  totalArticles: BoundedIntegerSchema,
  totalPreviewNodes: BoundedIntegerSchema,
  metadata: z.array(PreviewMetadataEntryDtoSchema).max(DESKTOP_IMPORT_LIMITS.maxMetadataEntries),
  callouts: z.array(PreviewCalloutDtoSchema).max(DESKTOP_IMPORT_LIMITS.maxCallouts),
});

export const PreviewNodeKindSchema = z.enum([
  'ato_transitorio',
  'livro',
  'titulo',
  'capitulo',
  'secao',
  'subsecao',
  'artigo',
  'paragrafo',
  'inciso',
  'alinea',
  'item',
  'pena',
  'anexo',
  'tabela',
]);

export const PreviewDeviceStatusSchema = z.enum([
  'active',
  'revoked',
  'vetoed',
  'included',
  'amended',
  'renumbered',
  'suspended',
  'unknown',
]);

export const SourceRangeDtoSchema = z
  .strictObject({
    sourceArtifactId: OpaqueIdSchema,
    startLine: z.number().int().positive().max(10_000_000),
    endLine: z.number().int().positive().max(10_000_000),
  })
  .refine(({ startLine, endLine }) => startLine <= endLine, {
    message: 'startLine não pode vir depois de endLine.',
    path: ['startLine'],
  });

export const PreviewHistoryDtoSchema = z.strictObject({
  plainText: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxPlainTextCharacters),
  note: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxDiagnosticMessageCharacters).nullable(),
});

export const PreviewLegalReferenceDtoSchema = z
  .strictObject({
    referenceId: Sha256Schema,
    state: z.enum(['detected', 'resolved', 'unresolved', 'ambiguous']),
    severity: z.enum(['error', 'warning', 'info']),
    start: BoundedIntegerSchema,
    end: BoundedIntegerSchema,
    label: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxPlainTextCharacters),
  })
  .superRefine(({ start, end, label }, context) => {
    if (end <= start) {
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'O fim da referência deve ser maior que o início.',
      });
    }
    if (label.length !== end - start) {
      context.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'O rótulo deve ocupar exatamente o intervalo UTF-16 declarado.',
      });
    }
  });

export const LegalReferencePreviewDtoSchema = z.strictObject({
  referenceId: Sha256Schema,
  targetTitle: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
  targetSigla: z.string().min(1).max(32),
  targetLegalPath: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxLabelCharacters),
  targetDeviceStatus: PreviewDeviceStatusSchema.nullable(),
  targetPlainText: z.string().max(DESKTOP_IMPORT_LIMITS.maxPlainTextCharacters),
  external: z.boolean(),
});

export const LegalReferenceNavigationDtoSchema = z.strictObject({
  targetProjectId: OpaqueIdSchema,
  targetPreviewNodeId: OpaqueIdSchema,
  external: z.boolean(),
});

export const PreviewNodeDtoSchema = z
  .strictObject({
    previewNodeId: OpaqueIdSchema,
    parentPreviewNodeId: OpaqueIdSchema.nullable(),
    nodeKind: PreviewNodeKindSchema,
    depth: z.number().int().nonnegative().max(DESKTOP_IMPORT_LIMITS.maxTreeDepth),
    order: BoundedIntegerSchema,
    label: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxLabelCharacters),
    plainText: z.string().max(DESKTOP_IMPORT_LIMITS.maxPlainTextCharacters),
    blockId: BlockIdSchema.nullable(),
    deviceStatus: PreviewDeviceStatusSchema.nullable(),
    hasChildren: z.boolean(),
    childCount: BoundedIntegerSchema,
    histories: z.array(PreviewHistoryDtoSchema).max(DESKTOP_IMPORT_LIMITS.maxHistoriesPerNode),
    legalReferences: z
      .array(PreviewLegalReferenceDtoSchema)
      .max(DESKTOP_IMPORT_LIMITS.maxLegalReferencesPerNode),
    sourceRange: SourceRangeDtoSchema.nullable(),
  })
  .refine(({ childCount, hasChildren }) => hasChildren === childCount > 0, {
    message: 'hasChildren deve refletir childCount.',
    path: ['hasChildren'],
  });

export const PreviewPageDtoSchema = z
  .strictObject({
    items: z.array(PreviewNodeDtoSchema).max(DESKTOP_IMPORT_LIMITS.previewPageMaxItems),
    nextCursor: CursorSchema.nullable(),
    totalItems: BoundedIntegerSchema,
  })
  .refine(({ items, totalItems }) => items.length <= totalItems, {
    message: 'A página não pode conter mais itens que o total declarado.',
    path: ['items'],
  });

export const PreviewNodePathDtoSchema = z
  .strictObject({
    items: z.array(PreviewNodeDtoSchema).max(DESKTOP_IMPORT_LIMITS.maxTreeDepth + 1),
  })
  .refine(
    ({ items }) =>
      items.every((item, index) =>
        index === 0
          ? item.parentPreviewNodeId === null
          : item.parentPreviewNodeId === items[index - 1]?.previewNodeId,
      ),
    { message: 'O caminho do preview deve ser uma cadeia contínua.', path: ['items'] },
  );

export const ProjectionPreferenceDtoSchema = z.strictObject({
  projectId: OpaqueIdSchema,
  projectionProfile: ContentProjectionProfileDtoSchema,
});

export const DiagnosticSeveritySchema = z.enum(['error', 'warning', 'info']);

export const DiagnosticDtoSchema = z.strictObject({
  diagnosticId: OpaqueIdSchema,
  severity: DiagnosticSeveritySchema,
  code: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u),
  message: z.string().min(1).max(DESKTOP_IMPORT_LIMITS.maxDiagnosticMessageCharacters),
  blocksExport: z.boolean(),
  previewNodeId: OpaqueIdSchema.nullable(),
  blockId: BlockIdSchema.nullable(),
  sourceRange: SourceRangeDtoSchema.nullable(),
});

export const DiagnosticPageDtoSchema = z
  .strictObject({
    items: z.array(DiagnosticDtoSchema).max(DESKTOP_IMPORT_LIMITS.diagnosticPageMaxItems),
    nextCursor: CursorSchema.nullable(),
    totalItems: BoundedIntegerSchema,
  })
  .refine(({ items, totalItems }) => items.length <= totalItems, {
    message: 'A página não pode conter mais itens que o total declarado.',
    path: ['items'],
  });

export const GetPreviewDocumentResultSchema = createResultSchema(PreviewDocumentDtoSchema);
export const GetPreviewPageResultSchema = createResultSchema(PreviewPageDtoSchema);
export const RevealPreviewNodeResultSchema = createResultSchema(PreviewNodePathDtoSchema);
export const SetPreviewProjectionProfileResultSchema = createResultSchema(
  ProjectionPreferenceDtoSchema,
);
export const GetLegalReferencePreviewResultSchema = createResultSchema(
  LegalReferencePreviewDtoSchema,
);
export const NavigateLegalReferenceResultSchema = createResultSchema(
  LegalReferenceNavigationDtoSchema,
);
export const GetDiagnosticPageResultSchema = createResultSchema(DiagnosticPageDtoSchema);

export type SourceKind = z.infer<typeof SourceKindSchema>;
export type ContentProjectionProfileDto = z.infer<typeof ContentProjectionProfileDtoSchema>;
export type SourceSummaryDto = z.infer<typeof SourceSummaryDtoSchema>;
export type SelectLocalSourceCommand = z.infer<typeof SelectLocalSourceCommandSchema>;
export type ImportFromUrlCommand = z.infer<typeof ImportFromUrlCommandSchema>;
export type StartProcessingCommand = z.infer<typeof StartProcessingCommandSchema>;
export type CancelJobCommand = z.infer<typeof CancelJobCommandSchema>;
export type GetPreviewDocumentCommand = z.infer<typeof GetPreviewDocumentCommandSchema>;
export type GetPreviewPageCommand = z.infer<typeof GetPreviewPageCommandSchema>;
export type RevealPreviewNodeCommand = z.infer<typeof RevealPreviewNodeCommandSchema>;
export type SetPreviewProjectionProfileCommand = z.infer<
  typeof SetPreviewProjectionProfileCommandSchema
>;
export type LegalReferenceCommand = z.infer<typeof LegalReferenceCommandSchema>;
export type GetDiagnosticPageCommand = z.infer<typeof GetDiagnosticPageCommandSchema>;
export type ChooseExportDestinationCommand = z.infer<typeof ChooseExportDestinationCommandSchema>;
export type WriteExportCommand = z.infer<typeof WriteExportCommandSchema>;
export type ChooseBatchExportDestinationCommand = z.infer<
  typeof ChooseBatchExportDestinationCommandSchema
>;
export type WriteBatchExportCommand = z.infer<typeof WriteBatchExportCommandSchema>;
export type JobAcceptedDto = z.infer<typeof JobAcceptedDtoSchema>;
export type CancelJobDto = z.infer<typeof CancelJobDtoSchema>;
export type DestinationSummaryDto = z.infer<typeof DestinationSummaryDtoSchema>;
export type ExportResultDto = z.infer<typeof ExportResultDtoSchema>;
export type BatchExportFailureCode = z.infer<typeof BatchExportFailureCodeSchema>;
export type BatchExportItemResultDto = z.infer<typeof BatchExportItemResultDtoSchema>;
export type BatchExportResultDto = z.infer<typeof BatchExportResultDtoSchema>;
export type SelectLocalSourceResult = z.infer<typeof SelectLocalSourceResultSchema>;
export type ImportFromUrlResult = z.infer<typeof ImportFromUrlResultSchema>;
export type StartProcessingResult = z.infer<typeof StartProcessingResultSchema>;
export type CancelJobResult = z.infer<typeof CancelJobResultSchema>;
export type ChooseExportDestinationResult = z.infer<typeof ChooseExportDestinationResultSchema>;
export type WriteExportResult = z.infer<typeof WriteExportResultSchema>;
export type ChooseBatchExportDestinationResult = z.infer<
  typeof ChooseBatchExportDestinationResultSchema
>;
export type WriteBatchExportResult = z.infer<typeof WriteBatchExportResultSchema>;
export type PipelineJobStatus = z.infer<typeof PipelineJobStatusSchema>;
export type PipelinePhase = z.infer<typeof PipelinePhaseSchema>;
export type ProgressDto = z.infer<typeof ProgressDtoSchema>;
export type PreviewMetadataEntryDto = z.infer<typeof PreviewMetadataEntryDtoSchema>;
export type PreviewCalloutDto = z.infer<typeof PreviewCalloutDtoSchema>;
export type PreviewDocumentDto = z.infer<typeof PreviewDocumentDtoSchema>;
export type PreviewNodeKind = z.infer<typeof PreviewNodeKindSchema>;
export type PreviewDeviceStatus = z.infer<typeof PreviewDeviceStatusSchema>;
export type SourceRangeDto = z.infer<typeof SourceRangeDtoSchema>;
export type PreviewHistoryDto = z.infer<typeof PreviewHistoryDtoSchema>;
export type PreviewLegalReferenceDto = z.infer<typeof PreviewLegalReferenceDtoSchema>;
export type LegalReferencePreviewDto = z.infer<typeof LegalReferencePreviewDtoSchema>;
export type LegalReferenceNavigationDto = z.infer<typeof LegalReferenceNavigationDtoSchema>;
export type PreviewNodeDto = z.infer<typeof PreviewNodeDtoSchema>;
export type PreviewPageDto = z.infer<typeof PreviewPageDtoSchema>;
export type PreviewNodePathDto = z.infer<typeof PreviewNodePathDtoSchema>;
export type ProjectionPreferenceDto = z.infer<typeof ProjectionPreferenceDtoSchema>;
export type GetPreviewDocumentResult = z.infer<typeof GetPreviewDocumentResultSchema>;
export type GetPreviewPageResult = z.infer<typeof GetPreviewPageResultSchema>;
export type RevealPreviewNodeResult = z.infer<typeof RevealPreviewNodeResultSchema>;
export type SetPreviewProjectionProfileResult = z.infer<
  typeof SetPreviewProjectionProfileResultSchema
>;
export type GetLegalReferencePreviewResult = z.infer<typeof GetLegalReferencePreviewResultSchema>;
export type NavigateLegalReferenceResult = z.infer<typeof NavigateLegalReferenceResultSchema>;
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;
export type DiagnosticDto = z.infer<typeof DiagnosticDtoSchema>;
export type DiagnosticPageDto = z.infer<typeof DiagnosticPageDtoSchema>;
export type GetDiagnosticPageResult = z.infer<typeof GetDiagnosticPageResultSchema>;
