import { z } from 'zod';

export const DESKTOP_API_VERSION = 1 as const;
export const APP_GET_VERSION_CHANNEL = 'app:get-version' as const;
export const DESKTOP_CAPABILITIES = Object.freeze(['app.getVersion'] as const);

export const DesktopErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'PAYLOAD_TOO_LARGE',
  'NOT_ALLOWED',
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
}>;

export const APP_GET_VERSION_INPUT: AppGetVersionInput = Object.freeze({});

export const createFailedResult = (code: DesktopErrorCode): AppGetVersionResult => ({
  ok: false,
  error: {
    code,
    message: 'A operação desktop não pôde ser concluída.',
    retryable: code === 'FAILED',
  },
});
