import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import {
  APP_GET_VERSION_CHANNEL,
  AppGetVersionInputSchema,
  AppVersionDtoSchema,
} from '../../shared/ipc/desktop-api.js';
import {
  CancelJobCommandSchema,
  CancelJobDtoSchema,
  ChooseExportDestinationCommandSchema,
  DIAGNOSTICS_GET_PAGE_CHANNEL,
  DESKTOP_IMPORT_LIMITS,
  DiagnosticPageDtoSchema,
  DestinationSummaryDtoSchema,
  EXPORT_CHOOSE_DESTINATION_CHANNEL,
  EXPORT_WRITE_CHANNEL,
  ExportResultDtoSchema,
  GetDiagnosticPageCommandSchema,
  GetPreviewDocumentCommandSchema,
  GetPreviewPageCommandSchema,
  ImportFromUrlCommandSchema,
  JobAcceptedDtoSchema,
  PIPELINE_CANCEL_CHANNEL,
  PIPELINE_START_CHANNEL,
  PREVIEW_GET_DOCUMENT_CHANNEL,
  PREVIEW_GET_PAGE_CHANNEL,
  PREVIEW_REVEAL_NODE_CHANNEL,
  PreviewDocumentDtoSchema,
  PreviewNodePathDtoSchema,
  PreviewPageDtoSchema,
  RevealPreviewNodeCommandSchema,
  SOURCE_SELECT_LOCAL_CHANNEL,
  SOURCE_IMPORT_URL_CHANNEL,
  SelectLocalSourceCommandSchema,
  SourceSummaryDtoSchema,
  StartProcessingCommandSchema,
  WriteExportCommandSchema,
} from '../../shared/ipc/import.js';
import type {
  CancelJobCommand,
  CancelJobDto,
  ChooseExportDestinationCommand,
  DiagnosticPageDto,
  DestinationSummaryDto,
  ExportResultDto,
  GetDiagnosticPageCommand,
  GetPreviewDocumentCommand,
  GetPreviewPageCommand,
  ImportFromUrlCommand,
  JobAcceptedDto,
  PreviewDocumentDto,
  PreviewNodePathDto,
  PreviewPageDto,
  RevealPreviewNodeCommand,
  SelectLocalSourceCommand,
  SourceSummaryDto,
  StartProcessingCommand,
  WriteExportCommand,
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
  getDiagnosticPage: NamedCapability<GetDiagnosticPageCommand, DiagnosticPageDto>;
  chooseExportDestination: NamedCapability<
    ChooseExportDestinationCommand,
    DestinationSummaryDto | null
  >;
  writeExport: NamedCapability<WriteExportCommand, ExportResultDto>;
}>;

type RegisterIpcHandlersOptions = Readonly<{
  rendererLocation: RendererLocation;
  getMainWindow(): BrowserWindow | null;
  importCapabilities?: DesktopImportIpcCapabilities;
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
  getDiagnosticPage: { authorize: () => true, handle: unavailable },
  chooseExportDestination: { authorize: () => true, handle: unavailable },
  writeExport: { authorize: () => true, handle: unavailable },
};

export const registerIpcHandlers = ({
  rendererLocation,
  getMainWindow,
  importCapabilities = unavailableImportCapabilities,
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

  return () => {
    ipcMain.removeHandler(APP_GET_VERSION_CHANNEL);
    ipcMain.removeHandler(SOURCE_SELECT_LOCAL_CHANNEL);
    ipcMain.removeHandler(SOURCE_IMPORT_URL_CHANNEL);
    ipcMain.removeHandler(PIPELINE_START_CHANNEL);
    ipcMain.removeHandler(PIPELINE_CANCEL_CHANNEL);
    ipcMain.removeHandler(PREVIEW_GET_DOCUMENT_CHANNEL);
    ipcMain.removeHandler(PREVIEW_GET_PAGE_CHANNEL);
    ipcMain.removeHandler(PREVIEW_REVEAL_NODE_CHANNEL);
    ipcMain.removeHandler(DIAGNOSTICS_GET_PAGE_CHANNEL);
    ipcMain.removeHandler(EXPORT_CHOOSE_DESTINATION_CHANNEL);
    ipcMain.removeHandler(EXPORT_WRITE_CHANNEL);
  };
};
