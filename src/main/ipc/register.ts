import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import {
  APP_GET_VERSION_CHANNEL,
  AppGetVersionInputSchema,
  AppVersionDtoSchema,
} from '../../shared/ipc/desktop-api.js';
import {
  ApproveEditorialCommandSchema,
  ConfirmEditorialInterpretationCommandSchema,
  ConfirmEditorialWarningCommandSchema,
  CorrectEditorialTextCommandSchema,
  DESKTOP_EDITORIAL_LIMITS,
  EDITORIAL_APPROVE_CHANNEL,
  EDITORIAL_CONFIRM_INTERPRETATION_CHANNEL,
  EDITORIAL_CONFIRM_WARNING_CHANNEL,
  EDITORIAL_CORRECT_TEXT_CHANNEL,
  EDITORIAL_GET_STATE_CHANNEL,
  EDITORIAL_VALIDATE_CHANNEL,
  EditorialStateDtoSchema,
  GetEditorialStateCommandSchema,
  ValidateEditorialCommandSchema,
} from '../../shared/ipc/editorial.js';
import type {
  ApproveEditorialCommand,
  ConfirmEditorialInterpretationCommand,
  ConfirmEditorialWarningCommand,
  CorrectEditorialTextCommand,
  EditorialStateDto,
  GetEditorialStateCommand,
  ValidateEditorialCommand,
} from '../../shared/ipc/editorial.js';
import {
  CancelJobCommandSchema,
  CancelJobDtoSchema,
  BatchExportResultDtoSchema,
  ChooseBatchExportDestinationCommandSchema,
  ChooseExportDestinationCommandSchema,
  DIAGNOSTICS_GET_PAGE_CHANNEL,
  DESKTOP_IMPORT_LIMITS,
  DiagnosticPageDtoSchema,
  DestinationSummaryDtoSchema,
  EXPORT_CHOOSE_DESTINATION_CHANNEL,
  EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL,
  EXPORT_WRITE_CHANNEL,
  EXPORT_WRITE_BATCH_CHANNEL,
  ExportResultDtoSchema,
  GetDiagnosticPageCommandSchema,
  LegalReferenceCommandSchema,
  LegalReferenceNavigationDtoSchema,
  LegalReferencePreviewDtoSchema,
  GetPreviewDocumentCommandSchema,
  GetPreviewPageCommandSchema,
  ImportFromUrlCommandSchema,
  JobAcceptedDtoSchema,
  PIPELINE_CANCEL_CHANNEL,
  PIPELINE_START_CHANNEL,
  PREVIEW_GET_DOCUMENT_CHANNEL,
  PREVIEW_GET_LEGAL_REFERENCE_CHANNEL,
  PREVIEW_GET_PAGE_CHANNEL,
  PREVIEW_REVEAL_NODE_CHANNEL,
  PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL,
  PREVIEW_SET_PROJECTION_PROFILE_CHANNEL,
  ProjectionPreferenceDtoSchema,
  PreviewDocumentDtoSchema,
  PreviewNodePathDtoSchema,
  PreviewPageDtoSchema,
  RevealPreviewNodeCommandSchema,
  SetPreviewProjectionProfileCommandSchema,
  SOURCE_SELECT_LOCAL_CHANNEL,
  SOURCE_IMPORT_URL_CHANNEL,
  SelectLocalSourceCommandSchema,
  SourceSummaryDtoSchema,
  StartProcessingCommandSchema,
  WriteExportCommandSchema,
  WriteBatchExportCommandSchema,
} from '../../shared/ipc/import.js';
import {
  DESKTOP_PUBLICATION_LIMITS,
  GetPublicationDiffCommandSchema,
  ListPublicationHistoryCommandSchema,
  PreparePublicationCommandSchema,
  PrepareRollbackCommandSchema,
  PUBLICATION_EXECUTE_CHANNEL,
  PUBLICATION_GET_ATTEMPT_CHANNEL,
  PUBLICATION_GET_DIFF_CHANNEL,
  PUBLICATION_LIST_HISTORY_CHANNEL,
  PUBLICATION_PREPARE_CHANNEL,
  PUBLICATION_PREPARE_ROLLBACK_CHANNEL,
  PUBLICATION_RETRY_CHANNEL,
  PublicationAttemptDtoSchema,
  PublicationConfirmationDtoSchema,
  PublicationDiffDtoSchema,
  PublicationHistoryPageDtoSchema,
  PublicationIdCommandSchema,
} from '../../shared/ipc/publication.js';
import {
  ApproveLegislativeUpdateCommandSchema,
  DESKTOP_UPDATE_LIMITS,
  GetLegislativeUpdateCountsCommandSchema,
  LegislativeUpdateCountsDtoSchema,
  LegislativeUpdateDecisionDtoSchema,
  LegislativeUpdateDetailDtoSchema,
  LegislativeUpdateIdCommandSchema,
  LegislativeUpdateListDtoSchema,
  ListLegislativeUpdatesCommandSchema,
  RejectLegislativeUpdateCommandSchema,
  UPDATES_APPROVE_CHANNEL,
  UPDATES_GET_COUNTS_CHANNEL,
  UPDATES_GET_DETAIL_CHANNEL,
  UPDATES_LIST_CHANNEL,
  UPDATES_REJECT_CHANNEL,
  UPDATES_REPROCESS_CHANNEL,
} from '../../shared/ipc/updates.js';
import {
  ActivateSourceBindingCommandSchema,
  ActivatedSourceBindingDtoSchema,
  ChangeSourceBindingActivationCommandSchema,
  ChangedSourceBindingActivationDtoSchema,
  CreateLawSourceBindingRevisionCommandSchema,
  CreatedLawSourceBindingRevisionDtoSchema,
  CreateSourceProviderRevisionCommandSchema,
  CreatedSourceProviderRevisionDtoSchema,
  DESKTOP_SOURCE_CATALOG_LIMITS,
  DryRunSourceBindingCommandSchema,
  ListSourceCatalogCommandSchema,
  SOURCES_ACTIVATE_CHANNEL,
  SOURCES_ARCHIVE_CHANNEL,
  SOURCES_CREATE_BINDING_REVISION_CHANNEL,
  SOURCES_CREATE_PROVIDER_REVISION_CHANNEL,
  SOURCES_DRY_RUN_CHANNEL,
  SOURCES_LIST_CHANNEL,
  SOURCES_PAUSE_CHANNEL,
  SOURCES_RESTORE_CHANNEL,
  SOURCES_REQUEST_CHECK_CHANNEL,
  RequestSourceCheckCommandSchema,
  RequestedSourceCheckDtoSchema,
  SourceCatalogPageDtoSchema,
  SourceDryRunDtoSchema,
} from '../../shared/ipc/sources.js';
import type {
  ActivateSourceBindingCommand,
  ActivatedSourceBindingDto,
  ChangeSourceBindingActivationCommand,
  ChangedSourceBindingActivationDto,
  CreateLawSourceBindingRevisionCommand,
  CreatedLawSourceBindingRevisionDto,
  CreateSourceProviderRevisionCommand,
  CreatedSourceProviderRevisionDto,
  DryRunSourceBindingCommand,
  ListSourceCatalogCommand,
  SourceCatalogPageDto,
  SourceDryRunDto,
  RequestSourceCheckCommand,
  RequestedSourceCheckDto,
} from '../../shared/ipc/sources.js';
import type {
  ApproveLegislativeUpdateCommand,
  GetLegislativeUpdateCountsCommand,
  LegislativeUpdateCountsDto,
  LegislativeUpdateDecisionDto,
  LegislativeUpdateDetailDto,
  LegislativeUpdateIdCommand,
  LegislativeUpdateListDto,
  ListLegislativeUpdatesCommand,
  RejectLegislativeUpdateCommand,
} from '../../shared/ipc/updates.js';
import type {
  GetPublicationDiffCommand,
  ListPublicationHistoryCommand,
  PreparePublicationCommand,
  PrepareRollbackCommand,
  PublicationAttemptDto,
  PublicationConfirmationDto,
  PublicationDiffDto,
  PublicationHistoryPageDto,
  PublicationIdCommand,
} from '../../shared/ipc/publication.js';
import type {
  BatchExportResultDto,
  CancelJobCommand,
  CancelJobDto,
  ChooseExportDestinationCommand,
  ChooseBatchExportDestinationCommand,
  DiagnosticPageDto,
  DestinationSummaryDto,
  ExportResultDto,
  GetDiagnosticPageCommand,
  LegalReferenceCommand,
  LegalReferenceNavigationDto,
  LegalReferencePreviewDto,
  GetPreviewDocumentCommand,
  GetPreviewPageCommand,
  ImportFromUrlCommand,
  JobAcceptedDto,
  PreviewDocumentDto,
  PreviewNodePathDto,
  PreviewPageDto,
  ProjectionPreferenceDto,
  RevealPreviewNodeCommand,
  SetPreviewProjectionProfileCommand,
  SelectLocalSourceCommand,
  SourceSummaryDto,
  StartProcessingCommand,
  WriteExportCommand,
  WriteBatchExportCommand,
} from '../../shared/ipc/import.js';
import type { RendererLocation } from '../renderer-location.js';
import { executeValidatedIpcHandler } from './validated-handler.js';

type MaybePromise<Value> = Promise<Value> | Value;

type NamedCapability<Input, Output> = Readonly<{
  authorize(input: Input): MaybePromise<boolean>;
  handle(input: Input): MaybePromise<Output>;
}>;

export type DesktopImportIpcCapabilities = Readonly<{
  selectLocal: NamedCapability<SelectLocalSourceCommand, SourceSummaryDto | null>;
  importFromUrl: NamedCapability<ImportFromUrlCommand, SourceSummaryDto>;
  startProcessing: NamedCapability<StartProcessingCommand, JobAcceptedDto>;
  cancelJob: NamedCapability<CancelJobCommand, CancelJobDto>;
  getPreviewDocument: NamedCapability<GetPreviewDocumentCommand, PreviewDocumentDto>;
  getPreviewPage: NamedCapability<GetPreviewPageCommand, PreviewPageDto>;
  revealPreviewNode: NamedCapability<RevealPreviewNodeCommand, PreviewNodePathDto>;
  setPreviewProjectionProfile: NamedCapability<
    SetPreviewProjectionProfileCommand,
    ProjectionPreferenceDto
  >;
  getLegalReference: NamedCapability<LegalReferenceCommand, LegalReferencePreviewDto>;
  navigateLegalReference: NamedCapability<LegalReferenceCommand, LegalReferenceNavigationDto>;
  getDiagnosticPage: NamedCapability<GetDiagnosticPageCommand, DiagnosticPageDto>;
  getEditorialState: NamedCapability<GetEditorialStateCommand, EditorialStateDto>;
  correctEditorialText: NamedCapability<CorrectEditorialTextCommand, EditorialStateDto>;
  confirmEditorialInterpretation: NamedCapability<
    ConfirmEditorialInterpretationCommand,
    EditorialStateDto
  >;
  confirmEditorialWarning: NamedCapability<ConfirmEditorialWarningCommand, EditorialStateDto>;
  validateEditorial: NamedCapability<ValidateEditorialCommand, EditorialStateDto>;
  approveEditorial: NamedCapability<ApproveEditorialCommand, EditorialStateDto>;
  chooseExportDestination: NamedCapability<
    ChooseExportDestinationCommand,
    DestinationSummaryDto | null
  >;
  writeExport: NamedCapability<WriteExportCommand, ExportResultDto>;
  chooseBatchExportDestination: NamedCapability<
    ChooseBatchExportDestinationCommand,
    DestinationSummaryDto | null
  >;
  writeBatchExport: NamedCapability<WriteBatchExportCommand, BatchExportResultDto>;
}>;

export type DesktopPublicationIpcCapabilities = Readonly<{
  preparePublication: NamedCapability<PreparePublicationCommand, PublicationConfirmationDto>;
  executePublication: NamedCapability<PublicationIdCommand, PublicationAttemptDto>;
  getPublicationAttempt: NamedCapability<PublicationIdCommand, PublicationAttemptDto>;
  retryPublication: NamedCapability<PublicationIdCommand, PublicationAttemptDto>;
  listPublicationHistory: NamedCapability<ListPublicationHistoryCommand, PublicationHistoryPageDto>;
  getPublicationDiff: NamedCapability<GetPublicationDiffCommand, PublicationDiffDto>;
  prepareRollback: NamedCapability<PrepareRollbackCommand, PublicationConfirmationDto>;
}>;

export type DesktopUpdateIpcCapabilities = Readonly<{
  listUpdates: NamedCapability<ListLegislativeUpdatesCommand, LegislativeUpdateListDto>;
  getUpdateDetail: NamedCapability<LegislativeUpdateIdCommand, LegislativeUpdateDetailDto>;
  getUpdateCounts: NamedCapability<GetLegislativeUpdateCountsCommand, LegislativeUpdateCountsDto>;
  approveUpdate: NamedCapability<ApproveLegislativeUpdateCommand, LegislativeUpdateDecisionDto>;
  rejectUpdate: NamedCapability<RejectLegislativeUpdateCommand, LegislativeUpdateDecisionDto>;
  reprocessUpdate: NamedCapability<LegislativeUpdateIdCommand, LegislativeUpdateDecisionDto>;
}>;

export type DesktopSourceCatalogIpcCapabilities = Readonly<{
  listCatalog: NamedCapability<ListSourceCatalogCommand, SourceCatalogPageDto>;
  createProviderRevision: NamedCapability<
    CreateSourceProviderRevisionCommand,
    CreatedSourceProviderRevisionDto
  >;
  createBindingRevision: NamedCapability<
    CreateLawSourceBindingRevisionCommand,
    CreatedLawSourceBindingRevisionDto
  >;
  dryRunBinding: NamedCapability<DryRunSourceBindingCommand, SourceDryRunDto>;
  activateBinding: NamedCapability<ActivateSourceBindingCommand, ActivatedSourceBindingDto>;
  pauseBinding: NamedCapability<
    ChangeSourceBindingActivationCommand,
    ChangedSourceBindingActivationDto
  >;
  archiveBinding: NamedCapability<
    ChangeSourceBindingActivationCommand,
    ChangedSourceBindingActivationDto
  >;
  restoreBinding: NamedCapability<ActivateSourceBindingCommand, ActivatedSourceBindingDto>;
  requestSourceCheck: NamedCapability<RequestSourceCheckCommand, RequestedSourceCheckDto>;
}>;

type RegisterIpcHandlersOptions = Readonly<{
  rendererLocation: RendererLocation;
  getMainWindow(): BrowserWindow | null;
  importCapabilities?: DesktopImportIpcCapabilities;
  publicationCapabilities?: DesktopPublicationIpcCapabilities;
  updateCapabilities?: DesktopUpdateIpcCapabilities;
  sourceCatalogCapabilities?: DesktopSourceCatalogIpcCapabilities;
}>;

const unavailable = (): never => {
  throw new Error('Desktop capability is not available yet.');
};

const unavailableImportCapabilities: DesktopImportIpcCapabilities = {
  selectLocal: { authorize: () => true, handle: unavailable },
  importFromUrl: { authorize: () => true, handle: unavailable },
  startProcessing: { authorize: () => true, handle: unavailable },
  cancelJob: { authorize: () => true, handle: unavailable },
  getPreviewDocument: { authorize: () => true, handle: unavailable },
  getPreviewPage: { authorize: () => true, handle: unavailable },
  revealPreviewNode: { authorize: () => true, handle: unavailable },
  setPreviewProjectionProfile: { authorize: () => true, handle: unavailable },
  getLegalReference: { authorize: () => true, handle: unavailable },
  navigateLegalReference: { authorize: () => true, handle: unavailable },
  getDiagnosticPage: { authorize: () => true, handle: unavailable },
  getEditorialState: { authorize: () => true, handle: unavailable },
  correctEditorialText: { authorize: () => true, handle: unavailable },
  confirmEditorialInterpretation: { authorize: () => true, handle: unavailable },
  confirmEditorialWarning: { authorize: () => true, handle: unavailable },
  validateEditorial: { authorize: () => true, handle: unavailable },
  approveEditorial: { authorize: () => true, handle: unavailable },
  chooseExportDestination: { authorize: () => true, handle: unavailable },
  writeExport: { authorize: () => true, handle: unavailable },
  chooseBatchExportDestination: { authorize: () => true, handle: unavailable },
  writeBatchExport: { authorize: () => true, handle: unavailable },
};

const unavailablePublicationCapabilities: DesktopPublicationIpcCapabilities = {
  preparePublication: { authorize: () => false, handle: unavailable },
  executePublication: { authorize: () => false, handle: unavailable },
  getPublicationAttempt: { authorize: () => false, handle: unavailable },
  retryPublication: { authorize: () => false, handle: unavailable },
  listPublicationHistory: { authorize: () => false, handle: unavailable },
  getPublicationDiff: { authorize: () => false, handle: unavailable },
  prepareRollback: { authorize: () => false, handle: unavailable },
};

const unavailableUpdateCapabilities: DesktopUpdateIpcCapabilities = {
  listUpdates: { authorize: () => false, handle: unavailable },
  getUpdateDetail: { authorize: () => false, handle: unavailable },
  getUpdateCounts: { authorize: () => false, handle: unavailable },
  approveUpdate: { authorize: () => false, handle: unavailable },
  rejectUpdate: { authorize: () => false, handle: unavailable },
  reprocessUpdate: { authorize: () => false, handle: unavailable },
};

const unavailableSourceCatalogCapabilities: DesktopSourceCatalogIpcCapabilities = {
  listCatalog: { authorize: () => false, handle: unavailable },
  createProviderRevision: { authorize: () => false, handle: unavailable },
  createBindingRevision: { authorize: () => false, handle: unavailable },
  dryRunBinding: { authorize: () => false, handle: unavailable },
  activateBinding: { authorize: () => false, handle: unavailable },
  pauseBinding: { authorize: () => false, handle: unavailable },
  archiveBinding: { authorize: () => false, handle: unavailable },
  restoreBinding: { authorize: () => false, handle: unavailable },
  requestSourceCheck: { authorize: () => false, handle: unavailable },
};

export const registerIpcHandlers = ({
  rendererLocation,
  getMainWindow,
  importCapabilities = unavailableImportCapabilities,
  publicationCapabilities = unavailablePublicationCapabilities,
  updateCapabilities = unavailableUpdateCapabilities,
  sourceCatalogCapabilities = unavailableSourceCatalogCapabilities,
}: RegisterIpcHandlersOptions): (() => void) => {
  const getTrustedWebContents = () => getMainWindow()?.webContents ?? null;

  ipcMain.handle(APP_GET_VERSION_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: AppGetVersionInputSchema,
      outputSchema: AppVersionDtoSchema,
      maxInputBytes: 256,
      maxOutputBytes: 256,
      authorize: () => true,
      handle: () => ({ version: app.getVersion() }),
    }),
  );

  ipcMain.handle(SOURCE_SELECT_LOCAL_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: SelectLocalSourceCommandSchema,
      outputSchema: SourceSummaryDtoSchema.nullable(),
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.sourceResultBytes,
      ...importCapabilities.selectLocal,
    }),
  );

  ipcMain.handle(SOURCE_IMPORT_URL_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ImportFromUrlCommandSchema,
      outputSchema: SourceSummaryDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.sourceResultBytes,
      ...importCapabilities.importFromUrl,
    }),
  );

  ipcMain.handle(PIPELINE_START_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: StartProcessingCommandSchema,
      outputSchema: JobAcceptedDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.actionResultBytes,
      ...importCapabilities.startProcessing,
    }),
  );

  ipcMain.handle(PIPELINE_CANCEL_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: CancelJobCommandSchema,
      outputSchema: CancelJobDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.actionResultBytes,
      ...importCapabilities.cancelJob,
    }),
  );

  ipcMain.handle(PREVIEW_GET_DOCUMENT_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: GetPreviewDocumentCommandSchema,
      outputSchema: PreviewDocumentDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.previewDocumentBytes,
      ...importCapabilities.getPreviewDocument,
    }),
  );

  ipcMain.handle(PREVIEW_GET_PAGE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: GetPreviewPageCommandSchema,
      outputSchema: PreviewPageDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.previewPageBytes,
      ...importCapabilities.getPreviewPage,
    }),
  );

  ipcMain.handle(PREVIEW_REVEAL_NODE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: RevealPreviewNodeCommandSchema,
      outputSchema: PreviewNodePathDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.previewPageBytes,
      ...importCapabilities.revealPreviewNode,
    }),
  );

  ipcMain.handle(PREVIEW_SET_PROJECTION_PROFILE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: SetPreviewProjectionProfileCommandSchema,
      outputSchema: ProjectionPreferenceDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.actionResultBytes,
      ...importCapabilities.setPreviewProjectionProfile,
    }),
  );

  ipcMain.handle(PREVIEW_GET_LEGAL_REFERENCE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: LegalReferenceCommandSchema,
      outputSchema: LegalReferencePreviewDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.previewDocumentBytes,
      ...importCapabilities.getLegalReference,
    }),
  );

  ipcMain.handle(PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: LegalReferenceCommandSchema,
      outputSchema: LegalReferenceNavigationDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.actionResultBytes,
      ...importCapabilities.navigateLegalReference,
    }),
  );

  ipcMain.handle(DIAGNOSTICS_GET_PAGE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: GetDiagnosticPageCommandSchema,
      outputSchema: DiagnosticPageDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.diagnosticPageBytes,
      ...importCapabilities.getDiagnosticPage,
    }),
  );

  ipcMain.handle(EDITORIAL_GET_STATE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: GetEditorialStateCommandSchema,
      outputSchema: EditorialStateDtoSchema,
      maxInputBytes: DESKTOP_EDITORIAL_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_EDITORIAL_LIMITS.stateBytes,
      ...importCapabilities.getEditorialState,
    }),
  );

  ipcMain.handle(EDITORIAL_CORRECT_TEXT_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: CorrectEditorialTextCommandSchema,
      outputSchema: EditorialStateDtoSchema,
      maxInputBytes: DESKTOP_EDITORIAL_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_EDITORIAL_LIMITS.stateBytes,
      ...importCapabilities.correctEditorialText,
    }),
  );

  ipcMain.handle(EDITORIAL_CONFIRM_INTERPRETATION_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ConfirmEditorialInterpretationCommandSchema,
      outputSchema: EditorialStateDtoSchema,
      maxInputBytes: DESKTOP_EDITORIAL_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_EDITORIAL_LIMITS.stateBytes,
      ...importCapabilities.confirmEditorialInterpretation,
    }),
  );

  ipcMain.handle(EDITORIAL_CONFIRM_WARNING_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ConfirmEditorialWarningCommandSchema,
      outputSchema: EditorialStateDtoSchema,
      maxInputBytes: DESKTOP_EDITORIAL_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_EDITORIAL_LIMITS.stateBytes,
      ...importCapabilities.confirmEditorialWarning,
    }),
  );

  ipcMain.handle(EDITORIAL_VALIDATE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ValidateEditorialCommandSchema,
      outputSchema: EditorialStateDtoSchema,
      maxInputBytes: DESKTOP_EDITORIAL_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_EDITORIAL_LIMITS.stateBytes,
      ...importCapabilities.validateEditorial,
    }),
  );

  ipcMain.handle(EDITORIAL_APPROVE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ApproveEditorialCommandSchema,
      outputSchema: EditorialStateDtoSchema,
      maxInputBytes: DESKTOP_EDITORIAL_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_EDITORIAL_LIMITS.stateBytes,
      ...importCapabilities.approveEditorial,
    }),
  );

  ipcMain.handle(EXPORT_CHOOSE_DESTINATION_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ChooseExportDestinationCommandSchema,
      outputSchema: DestinationSummaryDtoSchema.nullable(),
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.actionResultBytes,
      ...importCapabilities.chooseExportDestination,
    }),
  );

  ipcMain.handle(EXPORT_WRITE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: WriteExportCommandSchema,
      outputSchema: ExportResultDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.actionResultBytes,
      ...importCapabilities.writeExport,
    }),
  );

  ipcMain.handle(EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ChooseBatchExportDestinationCommandSchema,
      outputSchema: DestinationSummaryDtoSchema.nullable(),
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.actionResultBytes,
      ...importCapabilities.chooseBatchExportDestination,
    }),
  );

  ipcMain.handle(EXPORT_WRITE_BATCH_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: WriteBatchExportCommandSchema,
      outputSchema: BatchExportResultDtoSchema,
      maxInputBytes: DESKTOP_IMPORT_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_IMPORT_LIMITS.previewDocumentBytes,
      ...importCapabilities.writeBatchExport,
    }),
  );

  ipcMain.handle(PUBLICATION_PREPARE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: PreparePublicationCommandSchema,
      outputSchema: PublicationConfirmationDtoSchema,
      maxInputBytes: DESKTOP_PUBLICATION_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_PUBLICATION_LIMITS.confirmationBytes,
      ...publicationCapabilities.preparePublication,
    }),
  );

  ipcMain.handle(PUBLICATION_EXECUTE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: PublicationIdCommandSchema,
      outputSchema: PublicationAttemptDtoSchema,
      maxInputBytes: DESKTOP_PUBLICATION_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_PUBLICATION_LIMITS.attemptBytes,
      ...publicationCapabilities.executePublication,
    }),
  );

  ipcMain.handle(PUBLICATION_GET_ATTEMPT_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: PublicationIdCommandSchema,
      outputSchema: PublicationAttemptDtoSchema,
      maxInputBytes: DESKTOP_PUBLICATION_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_PUBLICATION_LIMITS.attemptBytes,
      ...publicationCapabilities.getPublicationAttempt,
    }),
  );

  ipcMain.handle(PUBLICATION_RETRY_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: PublicationIdCommandSchema,
      outputSchema: PublicationAttemptDtoSchema,
      maxInputBytes: DESKTOP_PUBLICATION_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_PUBLICATION_LIMITS.attemptBytes,
      ...publicationCapabilities.retryPublication,
    }),
  );

  ipcMain.handle(PUBLICATION_LIST_HISTORY_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ListPublicationHistoryCommandSchema,
      outputSchema: PublicationHistoryPageDtoSchema,
      maxInputBytes: DESKTOP_PUBLICATION_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_PUBLICATION_LIMITS.historyBytes,
      ...publicationCapabilities.listPublicationHistory,
    }),
  );

  ipcMain.handle(PUBLICATION_GET_DIFF_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: GetPublicationDiffCommandSchema,
      outputSchema: PublicationDiffDtoSchema,
      maxInputBytes: DESKTOP_PUBLICATION_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_PUBLICATION_LIMITS.diffBytes,
      ...publicationCapabilities.getPublicationDiff,
    }),
  );

  ipcMain.handle(PUBLICATION_PREPARE_ROLLBACK_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: PrepareRollbackCommandSchema,
      outputSchema: PublicationConfirmationDtoSchema,
      maxInputBytes: DESKTOP_PUBLICATION_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_PUBLICATION_LIMITS.confirmationBytes,
      ...publicationCapabilities.prepareRollback,
    }),
  );

  ipcMain.handle(UPDATES_LIST_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ListLegislativeUpdatesCommandSchema,
      outputSchema: LegislativeUpdateListDtoSchema,
      maxInputBytes: DESKTOP_UPDATE_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_UPDATE_LIMITS.listBytes,
      ...updateCapabilities.listUpdates,
    }),
  );

  ipcMain.handle(UPDATES_GET_DETAIL_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: LegislativeUpdateIdCommandSchema,
      outputSchema: LegislativeUpdateDetailDtoSchema,
      maxInputBytes: DESKTOP_UPDATE_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_UPDATE_LIMITS.detailBytes,
      ...updateCapabilities.getUpdateDetail,
    }),
  );

  ipcMain.handle(UPDATES_GET_COUNTS_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: GetLegislativeUpdateCountsCommandSchema,
      outputSchema: LegislativeUpdateCountsDtoSchema,
      maxInputBytes: DESKTOP_UPDATE_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_UPDATE_LIMITS.decisionBytes,
      ...updateCapabilities.getUpdateCounts,
    }),
  );

  ipcMain.handle(UPDATES_APPROVE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ApproveLegislativeUpdateCommandSchema,
      outputSchema: LegislativeUpdateDecisionDtoSchema,
      maxInputBytes: DESKTOP_UPDATE_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_UPDATE_LIMITS.decisionBytes,
      ...updateCapabilities.approveUpdate,
    }),
  );

  ipcMain.handle(UPDATES_REJECT_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: RejectLegislativeUpdateCommandSchema,
      outputSchema: LegislativeUpdateDecisionDtoSchema,
      maxInputBytes: DESKTOP_UPDATE_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_UPDATE_LIMITS.decisionBytes,
      ...updateCapabilities.rejectUpdate,
    }),
  );

  ipcMain.handle(UPDATES_REPROCESS_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: LegislativeUpdateIdCommandSchema,
      outputSchema: LegislativeUpdateDecisionDtoSchema,
      maxInputBytes: DESKTOP_UPDATE_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_UPDATE_LIMITS.decisionBytes,
      ...updateCapabilities.reprocessUpdate,
    }),
  );

  ipcMain.handle(SOURCES_LIST_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ListSourceCatalogCommandSchema,
      outputSchema: SourceCatalogPageDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.pageResultBytes,
      ...sourceCatalogCapabilities.listCatalog,
    }),
  );

  ipcMain.handle(SOURCES_CREATE_PROVIDER_REVISION_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: CreateSourceProviderRevisionCommandSchema,
      outputSchema: CreatedSourceProviderRevisionDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.actionResultBytes,
      ...sourceCatalogCapabilities.createProviderRevision,
    }),
  );

  ipcMain.handle(SOURCES_CREATE_BINDING_REVISION_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: CreateLawSourceBindingRevisionCommandSchema,
      outputSchema: CreatedLawSourceBindingRevisionDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.actionResultBytes,
      ...sourceCatalogCapabilities.createBindingRevision,
    }),
  );

  ipcMain.handle(SOURCES_DRY_RUN_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: DryRunSourceBindingCommandSchema,
      outputSchema: SourceDryRunDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.actionResultBytes,
      ...sourceCatalogCapabilities.dryRunBinding,
    }),
  );

  ipcMain.handle(SOURCES_ACTIVATE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ActivateSourceBindingCommandSchema,
      outputSchema: ActivatedSourceBindingDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.actionResultBytes,
      ...sourceCatalogCapabilities.activateBinding,
    }),
  );

  ipcMain.handle(SOURCES_PAUSE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ChangeSourceBindingActivationCommandSchema,
      outputSchema: ChangedSourceBindingActivationDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.actionResultBytes,
      ...sourceCatalogCapabilities.pauseBinding,
    }),
  );

  ipcMain.handle(SOURCES_ARCHIVE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ChangeSourceBindingActivationCommandSchema,
      outputSchema: ChangedSourceBindingActivationDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.actionResultBytes,
      ...sourceCatalogCapabilities.archiveBinding,
    }),
  );

  ipcMain.handle(SOURCES_RESTORE_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: ActivateSourceBindingCommandSchema,
      outputSchema: ActivatedSourceBindingDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.actionResultBytes,
      ...sourceCatalogCapabilities.restoreBinding,
    }),
  );

  ipcMain.handle(SOURCES_REQUEST_CHECK_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents,
      inputSchema: RequestSourceCheckCommandSchema,
      outputSchema: RequestedSourceCheckDtoSchema,
      maxInputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.commandBytes,
      maxOutputBytes: DESKTOP_SOURCE_CATALOG_LIMITS.actionResultBytes,
      ...sourceCatalogCapabilities.requestSourceCheck,
    }),
  );

  return () => {
    ipcMain.removeHandler(APP_GET_VERSION_CHANNEL);
    ipcMain.removeHandler(SOURCE_SELECT_LOCAL_CHANNEL);
    ipcMain.removeHandler(SOURCE_IMPORT_URL_CHANNEL);
    ipcMain.removeHandler(PIPELINE_START_CHANNEL);
    ipcMain.removeHandler(PIPELINE_CANCEL_CHANNEL);
    ipcMain.removeHandler(PREVIEW_GET_DOCUMENT_CHANNEL);
    ipcMain.removeHandler(PREVIEW_GET_PAGE_CHANNEL);
    ipcMain.removeHandler(PREVIEW_REVEAL_NODE_CHANNEL);
    ipcMain.removeHandler(PREVIEW_SET_PROJECTION_PROFILE_CHANNEL);
    ipcMain.removeHandler(PREVIEW_GET_LEGAL_REFERENCE_CHANNEL);
    ipcMain.removeHandler(PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL);
    ipcMain.removeHandler(DIAGNOSTICS_GET_PAGE_CHANNEL);
    ipcMain.removeHandler(EDITORIAL_GET_STATE_CHANNEL);
    ipcMain.removeHandler(EDITORIAL_CORRECT_TEXT_CHANNEL);
    ipcMain.removeHandler(EDITORIAL_CONFIRM_INTERPRETATION_CHANNEL);
    ipcMain.removeHandler(EDITORIAL_CONFIRM_WARNING_CHANNEL);
    ipcMain.removeHandler(EDITORIAL_VALIDATE_CHANNEL);
    ipcMain.removeHandler(EDITORIAL_APPROVE_CHANNEL);
    ipcMain.removeHandler(EXPORT_CHOOSE_DESTINATION_CHANNEL);
    ipcMain.removeHandler(EXPORT_WRITE_CHANNEL);
    ipcMain.removeHandler(EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL);
    ipcMain.removeHandler(EXPORT_WRITE_BATCH_CHANNEL);
    ipcMain.removeHandler(PUBLICATION_PREPARE_CHANNEL);
    ipcMain.removeHandler(PUBLICATION_EXECUTE_CHANNEL);
    ipcMain.removeHandler(PUBLICATION_GET_ATTEMPT_CHANNEL);
    ipcMain.removeHandler(PUBLICATION_RETRY_CHANNEL);
    ipcMain.removeHandler(PUBLICATION_LIST_HISTORY_CHANNEL);
    ipcMain.removeHandler(PUBLICATION_GET_DIFF_CHANNEL);
    ipcMain.removeHandler(PUBLICATION_PREPARE_ROLLBACK_CHANNEL);
    ipcMain.removeHandler(UPDATES_LIST_CHANNEL);
    ipcMain.removeHandler(UPDATES_GET_DETAIL_CHANNEL);
    ipcMain.removeHandler(UPDATES_GET_COUNTS_CHANNEL);
    ipcMain.removeHandler(UPDATES_APPROVE_CHANNEL);
    ipcMain.removeHandler(UPDATES_REJECT_CHANNEL);
    ipcMain.removeHandler(UPDATES_REPROCESS_CHANNEL);
    ipcMain.removeHandler(SOURCES_LIST_CHANNEL);
    ipcMain.removeHandler(SOURCES_CREATE_PROVIDER_REVISION_CHANNEL);
    ipcMain.removeHandler(SOURCES_CREATE_BINDING_REVISION_CHANNEL);
    ipcMain.removeHandler(SOURCES_DRY_RUN_CHANNEL);
    ipcMain.removeHandler(SOURCES_ACTIVATE_CHANNEL);
    ipcMain.removeHandler(SOURCES_PAUSE_CHANNEL);
    ipcMain.removeHandler(SOURCES_ARCHIVE_CHANNEL);
    ipcMain.removeHandler(SOURCES_RESTORE_CHANNEL);
    ipcMain.removeHandler(SOURCES_REQUEST_CHECK_CHANNEL);
  };
};
