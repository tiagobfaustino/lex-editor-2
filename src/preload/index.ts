import { contextBridge, ipcRenderer } from 'electron';
import type { z } from 'zod';

import {
  APP_GET_VERSION_CHANNEL,
  APP_GET_VERSION_INPUT,
  AppGetVersionResultSchema,
  DESKTOP_API_VERSION,
  DESKTOP_CAPABILITIES,
  createFailedResult,
} from '../shared/ipc/desktop-api.js';
import type { AppGetVersionResult, LexDesktopApiV1 } from '../shared/ipc/desktop-api.js';
import {
  ApproveEditorialCommandSchema,
  ApproveEditorialResultSchema,
  ConfirmEditorialInterpretationCommandSchema,
  ConfirmEditorialInterpretationResultSchema,
  ConfirmEditorialWarningCommandSchema,
  ConfirmEditorialWarningResultSchema,
  CorrectEditorialTextCommandSchema,
  CorrectEditorialTextResultSchema,
  EDITORIAL_APPROVE_CHANNEL,
  EDITORIAL_CONFIRM_INTERPRETATION_CHANNEL,
  EDITORIAL_CONFIRM_WARNING_CHANNEL,
  EDITORIAL_CORRECT_TEXT_CHANNEL,
  EDITORIAL_GET_STATE_CHANNEL,
  EDITORIAL_VALIDATE_CHANNEL,
  GetEditorialStateCommandSchema,
  GetEditorialStateResultSchema,
  ValidateEditorialCommandSchema,
  ValidateEditorialResultSchema,
} from '../shared/ipc/editorial.js';
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
} from '../shared/ipc/editorial.js';
import {
  CancelJobCommandSchema,
  CancelJobResultSchema,
  ChooseBatchExportDestinationCommandSchema,
  ChooseBatchExportDestinationResultSchema,
  ChooseExportDestinationResultSchema,
  ChooseExportDestinationCommandSchema,
  DIAGNOSTICS_GET_PAGE_CHANNEL,
  EXPORT_CHOOSE_DESTINATION_CHANNEL,
  EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL,
  EXPORT_WRITE_CHANNEL,
  EXPORT_WRITE_BATCH_CHANNEL,
  GetDiagnosticPageCommandSchema,
  GetDiagnosticPageResultSchema,
  GetLegalReferencePreviewResultSchema,
  GetPreviewDocumentCommandSchema,
  GetPreviewDocumentResultSchema,
  GetPreviewPageCommandSchema,
  GetPreviewPageResultSchema,
  ImportFromUrlCommandSchema,
  ImportFromUrlResultSchema,
  LegalReferenceCommandSchema,
  NavigateLegalReferenceResultSchema,
  PIPELINE_CANCEL_CHANNEL,
  PIPELINE_PROGRESS_CHANNEL,
  PIPELINE_START_CHANNEL,
  PREVIEW_GET_DOCUMENT_CHANNEL,
  PREVIEW_GET_LEGAL_REFERENCE_CHANNEL,
  PREVIEW_GET_PAGE_CHANNEL,
  PREVIEW_REVEAL_NODE_CHANNEL,
  PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL,
  PREVIEW_SET_PROJECTION_PROFILE_CHANNEL,
  ProgressDtoSchema,
  RevealPreviewNodeCommandSchema,
  RevealPreviewNodeResultSchema,
  SetPreviewProjectionProfileCommandSchema,
  SetPreviewProjectionProfileResultSchema,
  SOURCE_SELECT_LOCAL_CHANNEL,
  SOURCE_IMPORT_URL_CHANNEL,
  SelectLocalSourceCommandSchema,
  SelectLocalSourceResultSchema,
  StartProcessingCommandSchema,
  StartProcessingResultSchema,
  WriteExportCommandSchema,
  WriteExportResultSchema,
  WriteBatchExportCommandSchema,
  WriteBatchExportResultSchema,
} from '../shared/ipc/import.js';
import {
  GetPublicationDiffCommandSchema,
  ListPublicationHistoryCommandSchema,
  PreparePublicationCommandSchema,
  PreparePublicationResultSchema,
  PrepareRollbackCommandSchema,
  PrepareRollbackResultSchema,
  PUBLICATION_EXECUTE_CHANNEL,
  PUBLICATION_GET_ATTEMPT_CHANNEL,
  PUBLICATION_GET_DIFF_CHANNEL,
  PUBLICATION_LIST_HISTORY_CHANNEL,
  PUBLICATION_PREPARE_CHANNEL,
  PUBLICATION_PREPARE_ROLLBACK_CHANNEL,
  PUBLICATION_RETRY_CHANNEL,
  PublicationAttemptResultSchema,
  PublicationDiffResultSchema,
  PublicationHistoryResultSchema,
  PublicationIdCommandSchema,
} from '../shared/ipc/publication.js';
import {
  ActivateSourceBindingCommandSchema,
  ActivateSourceBindingResultSchema,
  ChangeSourceBindingActivationCommandSchema,
  ChangeSourceBindingActivationResultSchema,
  CreateLawSourceBindingRevisionCommandSchema,
  CreateLawSourceBindingRevisionResultSchema,
  CreateSourceProviderRevisionCommandSchema,
  CreateSourceProviderRevisionResultSchema,
  DryRunSourceBindingCommandSchema,
  DryRunSourceBindingResultSchema,
  ListSourceCatalogCommandSchema,
  ListSourceCatalogResultSchema,
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
  RequestSourceCheckResultSchema,
} from '../shared/ipc/sources.js';
import type {
  ActivateSourceBindingCommand,
  ActivateSourceBindingResult,
  ChangeSourceBindingActivationCommand,
  ChangeSourceBindingActivationResult,
  CreateLawSourceBindingRevisionCommand,
  CreateLawSourceBindingRevisionResult,
  CreateSourceProviderRevisionCommand,
  CreateSourceProviderRevisionResult,
  DryRunSourceBindingCommand,
  DryRunSourceBindingResult,
  ListSourceCatalogCommand,
  ListSourceCatalogResult,
  RequestSourceCheckCommand,
  RequestSourceCheckResult,
} from '../shared/ipc/sources.js';
import {
  ApproveLegislativeUpdateCommandSchema,
  GetLegislativeUpdateCountsCommandSchema,
  LegislativeUpdateCountsResultSchema,
  LegislativeUpdateDecisionResultSchema,
  LegislativeUpdateDetailResultSchema,
  LegislativeUpdateIdCommandSchema,
  LegislativeUpdateListResultSchema,
  ListLegislativeUpdatesCommandSchema,
  RejectLegislativeUpdateCommandSchema,
  UPDATES_APPROVE_CHANNEL,
  UPDATES_GET_COUNTS_CHANNEL,
  UPDATES_GET_DETAIL_CHANNEL,
  UPDATES_LIST_CHANNEL,
  UPDATES_REJECT_CHANNEL,
  UPDATES_REPROCESS_CHANNEL,
} from '../shared/ipc/updates.js';
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
} from '../shared/ipc/updates.js';
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
} from '../shared/ipc/publication.js';
import type {
  CancelJobCommand,
  CancelJobResult,
  ChooseBatchExportDestinationCommand,
  ChooseBatchExportDestinationResult,
  ChooseExportDestinationCommand,
  ChooseExportDestinationResult,
  GetDiagnosticPageCommand,
  GetDiagnosticPageResult,
  GetLegalReferencePreviewResult,
  GetPreviewDocumentCommand,
  GetPreviewDocumentResult,
  GetPreviewPageCommand,
  GetPreviewPageResult,
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
} from '../shared/ipc/import.js';

const invokeValidated = async <Result>(
  channel: string,
  payload: unknown,
  schema: z.ZodType<Result>,
): Promise<Result | undefined> => {
  try {
    const rawResult: unknown = await ipcRenderer.invoke(channel, payload);
    const parsedResult = schema.safeParse(rawResult);

    return parsedResult.success ? parsedResult.data : undefined;
  } catch {
    return undefined;
  }
};

const getVersion = async (): Promise<AppGetVersionResult> => {
  return (
    (await invokeValidated(
      APP_GET_VERSION_CHANNEL,
      APP_GET_VERSION_INPUT,
      AppGetVersionResultSchema,
    )) ?? createFailedResult('FAILED')
  );
};

const selectLocal = async (): Promise<SelectLocalSourceResult> =>
  (await invokeValidated(
    SOURCE_SELECT_LOCAL_CHANNEL,
    SelectLocalSourceCommandSchema.parse({}),
    SelectLocalSourceResultSchema,
  )) ?? createFailedResult('FAILED');

const importFromUrl = async (input: ImportFromUrlCommand): Promise<ImportFromUrlResult> => {
  const parsedInput = ImportFromUrlCommandSchema.safeParse(input);

  return parsedInput.success
    ? ((await invokeValidated(
        SOURCE_IMPORT_URL_CHANNEL,
        parsedInput.data,
        ImportFromUrlResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const startProcessing = async (input: StartProcessingCommand): Promise<StartProcessingResult> => {
  const parsedInput = StartProcessingCommandSchema.safeParse(input);

  return parsedInput.success
    ? ((await invokeValidated(
        PIPELINE_START_CHANNEL,
        parsedInput.data,
        StartProcessingResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const cancelJob = async (input: CancelJobCommand): Promise<CancelJobResult> => {
  const parsedInput = CancelJobCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(PIPELINE_CANCEL_CHANNEL, parsedInput.data, CancelJobResultSchema)) ??
        createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const getPreviewDocument = async (
  input: GetPreviewDocumentCommand,
): Promise<GetPreviewDocumentResult> => {
  const parsedInput = GetPreviewDocumentCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PREVIEW_GET_DOCUMENT_CHANNEL,
        parsedInput.data,
        GetPreviewDocumentResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const getPreviewPage = async (input: GetPreviewPageCommand): Promise<GetPreviewPageResult> => {
  const parsedInput = GetPreviewPageCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PREVIEW_GET_PAGE_CHANNEL,
        parsedInput.data,
        GetPreviewPageResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const revealPreviewNode = async (
  input: RevealPreviewNodeCommand,
): Promise<RevealPreviewNodeResult> => {
  const parsedInput = RevealPreviewNodeCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PREVIEW_REVEAL_NODE_CHANNEL,
        parsedInput.data,
        RevealPreviewNodeResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const setPreviewProjectionProfile = async (
  input: SetPreviewProjectionProfileCommand,
): Promise<SetPreviewProjectionProfileResult> => {
  const parsedInput = SetPreviewProjectionProfileCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PREVIEW_SET_PROJECTION_PROFILE_CHANNEL,
        parsedInput.data,
        SetPreviewProjectionProfileResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const getLegalReference = async (
  input: LegalReferenceCommand,
): Promise<GetLegalReferencePreviewResult> => {
  const parsedInput = LegalReferenceCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PREVIEW_GET_LEGAL_REFERENCE_CHANNEL,
        parsedInput.data,
        GetLegalReferencePreviewResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const navigateLegalReference = async (
  input: LegalReferenceCommand,
): Promise<NavigateLegalReferenceResult> => {
  const parsedInput = LegalReferenceCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL,
        parsedInput.data,
        NavigateLegalReferenceResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const getDiagnosticPage = async (
  input: GetDiagnosticPageCommand,
): Promise<GetDiagnosticPageResult> => {
  const parsedInput = GetDiagnosticPageCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        DIAGNOSTICS_GET_PAGE_CHANNEL,
        parsedInput.data,
        GetDiagnosticPageResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const getEditorialState = async (
  input: GetEditorialStateCommand,
): Promise<GetEditorialStateResult> => {
  const parsedInput = GetEditorialStateCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        EDITORIAL_GET_STATE_CHANNEL,
        parsedInput.data,
        GetEditorialStateResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const correctEditorialText = async (
  input: CorrectEditorialTextCommand,
): Promise<CorrectEditorialTextResult> => {
  const parsedInput = CorrectEditorialTextCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        EDITORIAL_CORRECT_TEXT_CHANNEL,
        parsedInput.data,
        CorrectEditorialTextResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const confirmEditorialInterpretation = async (
  input: ConfirmEditorialInterpretationCommand,
): Promise<ConfirmEditorialInterpretationResult> => {
  const parsedInput = ConfirmEditorialInterpretationCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        EDITORIAL_CONFIRM_INTERPRETATION_CHANNEL,
        parsedInput.data,
        ConfirmEditorialInterpretationResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const confirmEditorialWarning = async (
  input: ConfirmEditorialWarningCommand,
): Promise<ConfirmEditorialWarningResult> => {
  const parsedInput = ConfirmEditorialWarningCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        EDITORIAL_CONFIRM_WARNING_CHANNEL,
        parsedInput.data,
        ConfirmEditorialWarningResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const validateEditorial = async (
  input: ValidateEditorialCommand,
): Promise<ValidateEditorialResult> => {
  const parsedInput = ValidateEditorialCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        EDITORIAL_VALIDATE_CHANNEL,
        parsedInput.data,
        ValidateEditorialResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const approveEditorial = async (
  input: ApproveEditorialCommand,
): Promise<ApproveEditorialResult> => {
  const parsedInput = ApproveEditorialCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        EDITORIAL_APPROVE_CHANNEL,
        parsedInput.data,
        ApproveEditorialResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const onProgress = (listener: (progress: ProgressDto) => void): (() => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
    const parsed = ProgressDtoSchema.safeParse(value);
    if (parsed.success) listener(parsed.data);
  };
  ipcRenderer.on(PIPELINE_PROGRESS_CHANNEL, wrapped);
  return () => {
    ipcRenderer.removeListener(PIPELINE_PROGRESS_CHANNEL, wrapped);
  };
};

const chooseExportDestination = async (
  input: ChooseExportDestinationCommand,
): Promise<ChooseExportDestinationResult> => {
  const parsedInput = ChooseExportDestinationCommandSchema.safeParse(input);

  return parsedInput.success
    ? ((await invokeValidated(
        EXPORT_CHOOSE_DESTINATION_CHANNEL,
        parsedInput.data,
        ChooseExportDestinationResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const writeExport = async (input: WriteExportCommand): Promise<WriteExportResult> => {
  const parsedInput = WriteExportCommandSchema.safeParse(input);

  return parsedInput.success
    ? ((await invokeValidated(EXPORT_WRITE_CHANNEL, parsedInput.data, WriteExportResultSchema)) ??
        createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const chooseBatchExportDestination = async (
  input: ChooseBatchExportDestinationCommand,
): Promise<ChooseBatchExportDestinationResult> => {
  const parsedInput = ChooseBatchExportDestinationCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL,
        parsedInput.data,
        ChooseBatchExportDestinationResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const writeBatchExport = async (
  input: WriteBatchExportCommand,
): Promise<WriteBatchExportResult> => {
  const parsedInput = WriteBatchExportCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        EXPORT_WRITE_BATCH_CHANNEL,
        parsedInput.data,
        WriteBatchExportResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const preparePublication = async (
  input: PreparePublicationCommand,
): Promise<PreparePublicationResult> => {
  const parsedInput = PreparePublicationCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PUBLICATION_PREPARE_CHANNEL,
        parsedInput.data,
        PreparePublicationResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const invokePublicationAttempt = async (
  channel: string,
  input: PublicationIdCommand,
): Promise<PublicationAttemptResult> => {
  const parsedInput = PublicationIdCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(channel, parsedInput.data, PublicationAttemptResultSchema)) ??
        createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const executePublication = (input: PublicationIdCommand): Promise<PublicationAttemptResult> =>
  invokePublicationAttempt(PUBLICATION_EXECUTE_CHANNEL, input);

const getPublicationAttempt = (input: PublicationIdCommand): Promise<PublicationAttemptResult> =>
  invokePublicationAttempt(PUBLICATION_GET_ATTEMPT_CHANNEL, input);

const retryPublication = (input: PublicationIdCommand): Promise<PublicationAttemptResult> =>
  invokePublicationAttempt(PUBLICATION_RETRY_CHANNEL, input);

const listPublicationHistory = async (
  input: ListPublicationHistoryCommand,
): Promise<PublicationHistoryResult> => {
  const parsedInput = ListPublicationHistoryCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PUBLICATION_LIST_HISTORY_CHANNEL,
        parsedInput.data,
        PublicationHistoryResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const getPublicationDiff = async (
  input: GetPublicationDiffCommand,
): Promise<PublicationDiffResult> => {
  const parsedInput = GetPublicationDiffCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PUBLICATION_GET_DIFF_CHANNEL,
        parsedInput.data,
        PublicationDiffResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const prepareRollback = async (input: PrepareRollbackCommand): Promise<PrepareRollbackResult> => {
  const parsedInput = PrepareRollbackCommandSchema.safeParse(input);
  return parsedInput.success
    ? ((await invokeValidated(
        PUBLICATION_PREPARE_ROLLBACK_CHANNEL,
        parsedInput.data,
        PrepareRollbackResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const listLegislativeUpdates = async (
  input: ListLegislativeUpdatesCommand,
): Promise<LegislativeUpdateListResult> => {
  const parsed = ListLegislativeUpdatesCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        UPDATES_LIST_CHANNEL,
        parsed.data,
        LegislativeUpdateListResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const getLegislativeUpdateDetail = async (
  input: LegislativeUpdateIdCommand,
): Promise<LegislativeUpdateDetailResult> => {
  const parsed = LegislativeUpdateIdCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        UPDATES_GET_DETAIL_CHANNEL,
        parsed.data,
        LegislativeUpdateDetailResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const getLegislativeUpdateCounts = async (
  input: GetLegislativeUpdateCountsCommand,
): Promise<LegislativeUpdateCountsResult> => {
  const parsed = GetLegislativeUpdateCountsCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        UPDATES_GET_COUNTS_CHANNEL,
        parsed.data,
        LegislativeUpdateCountsResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const approveLegislativeUpdate = async (
  input: ApproveLegislativeUpdateCommand,
): Promise<LegislativeUpdateDecisionResult> => {
  const parsed = ApproveLegislativeUpdateCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        UPDATES_APPROVE_CHANNEL,
        parsed.data,
        LegislativeUpdateDecisionResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const rejectLegislativeUpdate = async (
  input: RejectLegislativeUpdateCommand,
): Promise<LegislativeUpdateDecisionResult> => {
  const parsed = RejectLegislativeUpdateCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        UPDATES_REJECT_CHANNEL,
        parsed.data,
        LegislativeUpdateDecisionResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const reprocessLegislativeUpdate = async (
  input: LegislativeUpdateIdCommand,
): Promise<LegislativeUpdateDecisionResult> => {
  const parsed = LegislativeUpdateIdCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        UPDATES_REPROCESS_CHANNEL,
        parsed.data,
        LegislativeUpdateDecisionResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const listSourceCatalog = async (
  input: ListSourceCatalogCommand,
): Promise<ListSourceCatalogResult> => {
  const parsed = ListSourceCatalogCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(SOURCES_LIST_CHANNEL, parsed.data, ListSourceCatalogResultSchema)) ??
        createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const createSourceProviderRevision = async (
  input: CreateSourceProviderRevisionCommand,
): Promise<CreateSourceProviderRevisionResult> => {
  const parsed = CreateSourceProviderRevisionCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        SOURCES_CREATE_PROVIDER_REVISION_CHANNEL,
        parsed.data,
        CreateSourceProviderRevisionResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const createLawSourceBindingRevision = async (
  input: CreateLawSourceBindingRevisionCommand,
): Promise<CreateLawSourceBindingRevisionResult> => {
  const parsed = CreateLawSourceBindingRevisionCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        SOURCES_CREATE_BINDING_REVISION_CHANNEL,
        parsed.data,
        CreateLawSourceBindingRevisionResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const dryRunSourceBinding = async (
  input: DryRunSourceBindingCommand,
): Promise<DryRunSourceBindingResult> => {
  const parsed = DryRunSourceBindingCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        SOURCES_DRY_RUN_CHANNEL,
        parsed.data,
        DryRunSourceBindingResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const invokeSourceBindingActivation = async (
  channel: typeof SOURCES_ACTIVATE_CHANNEL | typeof SOURCES_RESTORE_CHANNEL,
  input: ActivateSourceBindingCommand,
): Promise<ActivateSourceBindingResult> => {
  const parsed = ActivateSourceBindingCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(channel, parsed.data, ActivateSourceBindingResultSchema)) ??
        createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const invokeSourceBindingStateChange = async (
  channel: typeof SOURCES_PAUSE_CHANNEL | typeof SOURCES_ARCHIVE_CHANNEL,
  input: ChangeSourceBindingActivationCommand,
): Promise<ChangeSourceBindingActivationResult> => {
  const parsed = ChangeSourceBindingActivationCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(channel, parsed.data, ChangeSourceBindingActivationResultSchema)) ??
        createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const requestSourceCheck = async (
  input: RequestSourceCheckCommand,
): Promise<RequestSourceCheckResult> => {
  const parsed = RequestSourceCheckCommandSchema.safeParse(input);
  return parsed.success
    ? ((await invokeValidated(
        SOURCES_REQUEST_CHECK_CHANNEL,
        parsed.data,
        RequestSourceCheckResultSchema,
      )) ?? createFailedResult('FAILED'))
    : createFailedResult('INVALID_INPUT');
};

const desktopApi: LexDesktopApiV1 = Object.freeze({
  version: DESKTOP_API_VERSION,
  capabilities: DESKTOP_CAPABILITIES,
  app: Object.freeze({
    getVersion,
  }),
  source: Object.freeze({
    selectLocal,
    importFromUrl,
  }),
  pipeline: Object.freeze({
    start: startProcessing,
    cancel: cancelJob,
    onProgress,
  }),
  preview: Object.freeze({
    getDocument: getPreviewDocument,
    getPage: getPreviewPage,
    revealNode: revealPreviewNode,
    setProjectionProfile: setPreviewProjectionProfile,
    getLegalReference,
    navigateLegalReference,
  }),
  diagnostics: Object.freeze({
    getPage: getDiagnosticPage,
  }),
  editorial: Object.freeze({
    getState: getEditorialState,
    correctText: correctEditorialText,
    confirmInterpretation: confirmEditorialInterpretation,
    confirmWarning: confirmEditorialWarning,
    validate: validateEditorial,
    approve: approveEditorial,
  }),
  export: Object.freeze({
    chooseDestination: chooseExportDestination,
    write: writeExport,
    chooseBatchDestination: chooseBatchExportDestination,
    writeBatch: writeBatchExport,
  }),
  publication: Object.freeze({
    prepare: preparePublication,
    execute: executePublication,
    getAttempt: getPublicationAttempt,
    retry: retryPublication,
    listHistory: listPublicationHistory,
    getDiff: getPublicationDiff,
    prepareRollback,
  }),
  updates: Object.freeze({
    list: listLegislativeUpdates,
    getDetail: getLegislativeUpdateDetail,
    getCounts: getLegislativeUpdateCounts,
    approve: approveLegislativeUpdate,
    reject: rejectLegislativeUpdate,
    reprocess: reprocessLegislativeUpdate,
  }),
  sources: Object.freeze({
    list: listSourceCatalog,
    createProviderRevision: createSourceProviderRevision,
    createBindingRevision: createLawSourceBindingRevision,
    dryRun: dryRunSourceBinding,
    activate: (input: ActivateSourceBindingCommand) =>
      invokeSourceBindingActivation(SOURCES_ACTIVATE_CHANNEL, input),
    pause: (input: ChangeSourceBindingActivationCommand) =>
      invokeSourceBindingStateChange(SOURCES_PAUSE_CHANNEL, input),
    archive: (input: ChangeSourceBindingActivationCommand) =>
      invokeSourceBindingStateChange(SOURCES_ARCHIVE_CHANNEL, input),
    restore: (input: ActivateSourceBindingCommand) =>
      invokeSourceBindingActivation(SOURCES_RESTORE_CHANNEL, input),
    requestCheck: requestSourceCheck,
  }),
});

contextBridge.exposeInMainWorld('lexDesktop', desktopApi);
