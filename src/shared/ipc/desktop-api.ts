import { z } from 'zod';

import type {
  CancelJobCommand,
  CancelJobResult,
  ChooseExportDestinationCommand,
  ChooseExportDestinationResult,
  ChooseBatchExportDestinationCommand,
  ChooseBatchExportDestinationResult,
  GetDiagnosticPageCommand,
  GetDiagnosticPageResult,
  GetPreviewDocumentCommand,
  GetPreviewDocumentResult,
  GetPreviewPageCommand,
  GetPreviewPageResult,
  GetLegalReferencePreviewResult,
  ImportFromUrlCommand,
  ImportFromUrlResult,
  LegalReferenceCommand,
  NavigateLegalReferenceResult,
  ProgressDto,
  RevealPreviewNodeCommand,
  RevealPreviewNodeResult,
  SetPreviewProjectionProfileCommand,
  SetPreviewProjectionProfileResult,
  SelectLocalSourceResult,
  StartProcessingCommand,
  StartProcessingResult,
  WriteExportCommand,
  WriteExportResult,
  WriteBatchExportCommand,
  WriteBatchExportResult,
} from './import.js';
import type {
  ApproveEditorialCommand,
  ApproveEditorialResult,
  ConfirmEditorialInterpretationCommand,
  ConfirmEditorialInterpretationResult,
  ConfirmEditorialWarningCommand,
  ConfirmEditorialWarningResult,
  CorrectEditorialTextCommand,
  CorrectEditorialTextResult,
  GetEditorialStateCommand,
  GetEditorialStateResult,
  ValidateEditorialCommand,
  ValidateEditorialResult,
} from './editorial.js';
import type {
  GetMetadataStateCommand,
  GetMetadataStateResult,
  UpdateMetadataCommand,
  UpdateMetadataResult,
} from './metadata.js';
import type {
  GetPublicationDiffCommand,
  ListPublicationHistoryCommand,
  PreparePublicationCommand,
  PreparePublicationResult,
  PrepareRollbackCommand,
  PrepareRollbackResult,
  PublicationAttemptResult,
  PublicationDiffResult,
  PublicationHistoryResult,
  PublicationIdCommand,
} from './publication.js';
import type {
  ApproveLegislativeUpdateCommand,
  GetLegislativeUpdateCountsCommand,
  LegislativeUpdateCountsResult,
  LegislativeUpdateDecisionResult,
  LegislativeUpdateDetailResult,
  LegislativeUpdateIdCommand,
  LegislativeUpdateListResult,
  ListLegislativeUpdatesCommand,
  RejectLegislativeUpdateCommand,
} from './updates.js';
import type {
  ActivateSourceBindingCommand,
  ActivateSourceBindingResult,
  ChangeSourceBindingActivationCommand,
  ChangeSourceBindingActivationResult,
  RequestSourceCheckCommand,
  RequestSourceCheckResult,
  CreateLawSourceBindingRevisionCommand,
  CreateLawSourceBindingRevisionResult,
  CreateSourceProviderRevisionCommand,
  CreateSourceProviderRevisionResult,
  DryRunSourceBindingCommand,
  DryRunSourceBindingResult,
  ListSourceCatalogCommand,
  ListSourceCatalogResult,
} from './sources.js';
import type {
  AuditEventDetailResult,
  AuditEventIdCommand,
  AuditQueryCommand,
  AuditQueryResult,
  AuditTimelineCommand,
  AuditTimelineResult,
  EvidenceExcerptResult,
  IncidentDetailResult,
  IncidentIdCommand,
  OpenEvidenceCommand,
  RecordIncidentNoteCommand,
} from './audit.js';
import type {
  GetReprocessingStateCommand,
  GetReprocessingStateResult,
  RequestReprocessingCommand,
  RequestReprocessingResult,
} from './reprocessing.js';

export const DESKTOP_API_VERSION = 1 as const;
export const APP_GET_VERSION_CHANNEL = 'app:get-version' as const;
export const DESKTOP_CAPABILITIES = Object.freeze([
  'app.getVersion',
  'source.selectLocal',
  'source.importFromUrl',
  'pipeline.start',
  'pipeline.cancel',
  'pipeline.onProgress',
  'preview.getDocument',
  'preview.getPage',
  'preview.revealNode',
  'preview.setProjectionProfile',
  'preview.getLegalReference',
  'preview.navigateLegalReference',
  'diagnostics.getPage',
  'editorial.getState',
  'editorial.correctText',
  'editorial.confirmInterpretation',
  'editorial.confirmWarning',
  'editorial.validate',
  'editorial.approve',
  'metadata.getState',
  'metadata.update',
  'export.chooseDestination',
  'export.write',
  'export.chooseBatchDestination',
  'export.writeBatch',
  'reprocessing.request',
  'reprocessing.getState',
  'publication.prepare',
  'publication.execute',
  'publication.getAttempt',
  'publication.retry',
  'publication.listHistory',
  'publication.getDiff',
  'publication.prepareRollback',
  'updates.list',
  'updates.getDetail',
  'updates.getCounts',
  'updates.approve',
  'updates.reject',
  'updates.reprocess',
  'sources.list',
  'sources.createProviderRevision',
  'sources.createBindingRevision',
  'sources.dryRun',
  'sources.activate',
  'sources.pause',
  'sources.archive',
  'sources.restore',
  'sources.requestCheck',
  'audit.query',
  'audit.getDetail',
  'audit.getTimeline',
  'audit.getIncidentDetail',
  'audit.recordIncidentNote',
  'audit.openEvidence',
] as const);

export const DesktopErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'PAYLOAD_TOO_LARGE',
  'NOT_ALLOWED',
  'CONFLICT',
  'NETWORK_NOT_ALLOWED',
  'NETWORK_DNS',
  'NETWORK_TIMEOUT',
  'NETWORK_HTTP',
  'NETWORK_CONTENT_TYPE',
  'NETWORK_TOO_LARGE',
  'NETWORK_CERTIFICATE',
  'FAILED',
]);

export const DesktopErrorDtoSchema = z.strictObject({
  code: DesktopErrorCodeSchema,
  message: z.string().min(1).max(160),
  retryable: z.boolean(),
});

export const AppGetVersionInputSchema = z.strictObject({});

export const AppVersionDtoSchema = z.strictObject({
  version: z.string().min(1).max(64),
});

export const AppGetVersionResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    value: AppVersionDtoSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: DesktopErrorDtoSchema,
  }),
]);

export type DesktopErrorCode = z.infer<typeof DesktopErrorCodeSchema>;
export type DesktopErrorDto = z.infer<typeof DesktopErrorDtoSchema>;
export type AppGetVersionInput = z.infer<typeof AppGetVersionInputSchema>;
export type AppVersionDto = z.infer<typeof AppVersionDtoSchema>;
export type AppGetVersionResult = z.infer<typeof AppGetVersionResultSchema>;

export type IpcResult<Value> =
  Readonly<{ ok: true; value: Value }> | Readonly<{ ok: false; error: DesktopErrorDto }>;

export type LexDesktopApiV1 = Readonly<{
  version: typeof DESKTOP_API_VERSION;
  capabilities: typeof DESKTOP_CAPABILITIES;
  app: Readonly<{
    getVersion(): Promise<AppGetVersionResult>;
  }>;
  source: Readonly<{
    selectLocal(): Promise<SelectLocalSourceResult>;
    importFromUrl(input: ImportFromUrlCommand): Promise<ImportFromUrlResult>;
  }>;
  pipeline: Readonly<{
    start(input: StartProcessingCommand): Promise<StartProcessingResult>;
    cancel(input: CancelJobCommand): Promise<CancelJobResult>;
    onProgress(listener: (progress: ProgressDto) => void): () => void;
  }>;
  preview: Readonly<{
    getDocument(input: GetPreviewDocumentCommand): Promise<GetPreviewDocumentResult>;
    getPage(input: GetPreviewPageCommand): Promise<GetPreviewPageResult>;
    revealNode(input: RevealPreviewNodeCommand): Promise<RevealPreviewNodeResult>;
    setProjectionProfile(
      input: SetPreviewProjectionProfileCommand,
    ): Promise<SetPreviewProjectionProfileResult>;
    getLegalReference(input: LegalReferenceCommand): Promise<GetLegalReferencePreviewResult>;
    navigateLegalReference(input: LegalReferenceCommand): Promise<NavigateLegalReferenceResult>;
  }>;
  diagnostics: Readonly<{
    getPage(input: GetDiagnosticPageCommand): Promise<GetDiagnosticPageResult>;
  }>;
  editorial: Readonly<{
    getState(input: GetEditorialStateCommand): Promise<GetEditorialStateResult>;
    correctText(input: CorrectEditorialTextCommand): Promise<CorrectEditorialTextResult>;
    confirmInterpretation(
      input: ConfirmEditorialInterpretationCommand,
    ): Promise<ConfirmEditorialInterpretationResult>;
    confirmWarning(input: ConfirmEditorialWarningCommand): Promise<ConfirmEditorialWarningResult>;
    validate(input: ValidateEditorialCommand): Promise<ValidateEditorialResult>;
    approve(input: ApproveEditorialCommand): Promise<ApproveEditorialResult>;
  }>;
  metadata: Readonly<{
    getState(input: GetMetadataStateCommand): Promise<GetMetadataStateResult>;
    update(input: UpdateMetadataCommand): Promise<UpdateMetadataResult>;
  }>;
  export: Readonly<{
    chooseDestination(
      input: ChooseExportDestinationCommand,
    ): Promise<ChooseExportDestinationResult>;
    write(input: WriteExportCommand): Promise<WriteExportResult>;
    chooseBatchDestination(
      input: ChooseBatchExportDestinationCommand,
    ): Promise<ChooseBatchExportDestinationResult>;
    writeBatch(input: WriteBatchExportCommand): Promise<WriteBatchExportResult>;
  }>;
  reprocessing: Readonly<{
    request(input: RequestReprocessingCommand): Promise<RequestReprocessingResult>;
    getState(input: GetReprocessingStateCommand): Promise<GetReprocessingStateResult>;
  }>;
  publication: Readonly<{
    prepare(input: PreparePublicationCommand): Promise<PreparePublicationResult>;
    execute(input: PublicationIdCommand): Promise<PublicationAttemptResult>;
    getAttempt(input: PublicationIdCommand): Promise<PublicationAttemptResult>;
    retry(input: PublicationIdCommand): Promise<PublicationAttemptResult>;
    listHistory(input: ListPublicationHistoryCommand): Promise<PublicationHistoryResult>;
    getDiff(input: GetPublicationDiffCommand): Promise<PublicationDiffResult>;
    prepareRollback(input: PrepareRollbackCommand): Promise<PrepareRollbackResult>;
  }>;
  updates: Readonly<{
    list(input: ListLegislativeUpdatesCommand): Promise<LegislativeUpdateListResult>;
    getDetail(input: LegislativeUpdateIdCommand): Promise<LegislativeUpdateDetailResult>;
    getCounts(input: GetLegislativeUpdateCountsCommand): Promise<LegislativeUpdateCountsResult>;
    approve(input: ApproveLegislativeUpdateCommand): Promise<LegislativeUpdateDecisionResult>;
    reject(input: RejectLegislativeUpdateCommand): Promise<LegislativeUpdateDecisionResult>;
    reprocess(input: LegislativeUpdateIdCommand): Promise<LegislativeUpdateDecisionResult>;
  }>;
  sources: Readonly<{
    list(input: ListSourceCatalogCommand): Promise<ListSourceCatalogResult>;
    createProviderRevision(
      input: CreateSourceProviderRevisionCommand,
    ): Promise<CreateSourceProviderRevisionResult>;
    createBindingRevision(
      input: CreateLawSourceBindingRevisionCommand,
    ): Promise<CreateLawSourceBindingRevisionResult>;
    dryRun(input: DryRunSourceBindingCommand): Promise<DryRunSourceBindingResult>;
    activate(input: ActivateSourceBindingCommand): Promise<ActivateSourceBindingResult>;
    pause(
      input: ChangeSourceBindingActivationCommand,
    ): Promise<ChangeSourceBindingActivationResult>;
    archive(
      input: ChangeSourceBindingActivationCommand,
    ): Promise<ChangeSourceBindingActivationResult>;
    restore(input: ActivateSourceBindingCommand): Promise<ActivateSourceBindingResult>;
    requestCheck(input: RequestSourceCheckCommand): Promise<RequestSourceCheckResult>;
  }>;
  audit: Readonly<{
    query(input: AuditQueryCommand): Promise<AuditQueryResult>;
    getDetail(input: AuditEventIdCommand): Promise<AuditEventDetailResult>;
    getTimeline(input: AuditTimelineCommand): Promise<AuditTimelineResult>;
    getIncidentDetail(input: IncidentIdCommand): Promise<IncidentDetailResult>;
    recordIncidentNote(input: RecordIncidentNoteCommand): Promise<IncidentDetailResult>;
    openEvidence(input: OpenEvidenceCommand): Promise<EvidenceExcerptResult>;
  }>;
}>;

export const APP_GET_VERSION_INPUT: AppGetVersionInput = Object.freeze({});

export const createFailedResult = <Value>(code: DesktopErrorCode): IpcResult<Value> => ({
  ok: false,
  error: {
    code,
    message: 'A operação desktop não pôde ser concluída.',
    retryable: ['FAILED', 'CONFLICT', 'NETWORK_DNS', 'NETWORK_TIMEOUT', 'NETWORK_HTTP'].includes(
      code,
    ),
  },
});
