import { z } from 'zod';

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
} from './import.js';

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
  'diagnostics.getPage',
  'export.chooseDestination',
  'export.write',
] as const);

export const DesktopErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'PAYLOAD_TOO_LARGE',
  'NOT_ALLOWED',
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
  }>;
  diagnostics: Readonly<{
    getPage(input: GetDiagnosticPageCommand): Promise<GetDiagnosticPageResult>;
  }>;
  export: Readonly<{
    chooseDestination(
      input: ChooseExportDestinationCommand,
    ): Promise<ChooseExportDestinationResult>;
    write(input: WriteExportCommand): Promise<WriteExportResult>;
  }>;
}>;

export const APP_GET_VERSION_INPUT: AppGetVersionInput = Object.freeze({});

export const createFailedResult = <Value>(code: DesktopErrorCode): IpcResult<Value> => ({
  ok: false,
  error: {
    code,
    message: 'A operação desktop não pôde ser concluída.',
    retryable: ['FAILED', 'NETWORK_DNS', 'NETWORK_TIMEOUT', 'NETWORK_HTTP'].includes(code),
  },
});
