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
  CancelJobCommandSchema,
  CancelJobResultSchema,
  ChooseExportDestinationResultSchema,
  ChooseExportDestinationCommandSchema,
  DIAGNOSTICS_GET_PAGE_CHANNEL,
  EXPORT_CHOOSE_DESTINATION_CHANNEL,
  EXPORT_WRITE_CHANNEL,
  GetDiagnosticPageCommandSchema,
  GetDiagnosticPageResultSchema,
  GetPreviewDocumentCommandSchema,
  GetPreviewDocumentResultSchema,
  GetPreviewPageCommandSchema,
  GetPreviewPageResultSchema,
  ImportFromUrlCommandSchema,
  ImportFromUrlResultSchema,
  PIPELINE_CANCEL_CHANNEL,
  PIPELINE_PROGRESS_CHANNEL,
  PIPELINE_START_CHANNEL,
  PREVIEW_GET_DOCUMENT_CHANNEL,
  PREVIEW_GET_PAGE_CHANNEL,
  PREVIEW_REVEAL_NODE_CHANNEL,
  ProgressDtoSchema,
  RevealPreviewNodeCommandSchema,
  RevealPreviewNodeResultSchema,
  SOURCE_SELECT_LOCAL_CHANNEL,
  SOURCE_IMPORT_URL_CHANNEL,
  SelectLocalSourceCommandSchema,
  SelectLocalSourceResultSchema,
  StartProcessingCommandSchema,
  StartProcessingResultSchema,
  WriteExportCommandSchema,
  WriteExportResultSchema,
} from '../shared/ipc/import.js';
import type {
  CancelJobCommand,
  CancelJobResult,
  ChooseExportDestinationCommand,
  ChooseExportDestinationResult,
  GetDiagnosticPageCommand,
  GetDiagnosticPageResult,
  GetPreviewDocumentCommand,
  GetPreviewDocumentResult,
  GetPreviewPageCommand,
  GetPreviewPageResult,
  ImportFromUrlCommand,
  ImportFromUrlResult,
  ProgressDto,
  RevealPreviewNodeCommand,
  RevealPreviewNodeResult,
  SelectLocalSourceResult,
  StartProcessingCommand,
  StartProcessingResult,
  WriteExportCommand,
  WriteExportResult,
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
  }),
  diagnostics: Object.freeze({
    getPage: getDiagnosticPage,
  }),
  export: Object.freeze({
    chooseDestination: chooseExportDestination,
    write: writeExport,
  }),
});

contextBridge.exposeInMainWorld('lexDesktop', desktopApi);
