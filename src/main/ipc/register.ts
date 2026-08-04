import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import {
  APP_GET_VERSION_CHANNEL,
  AppGetVersionInputSchema,
  AppVersionDtoSchema,
} from '../../shared/ipc/desktop-api.js';
import type { RendererLocation } from '../renderer-location.js';
import { executeValidatedIpcHandler } from './validated-handler.js';

type RegisterIpcHandlersOptions = Readonly<{
  rendererLocation: RendererLocation;
  getMainWindow(): BrowserWindow | null;
}>;

export const registerIpcHandlers = ({
  rendererLocation,
  getMainWindow,
}: RegisterIpcHandlersOptions): (() => void) => {
  ipcMain.handle(APP_GET_VERSION_CHANNEL, (event, payload: unknown) =>
    executeValidatedIpcHandler(event, payload, {
      rendererLocation,
      getTrustedWebContents: () => getMainWindow()?.webContents ?? null,
      inputSchema: AppGetVersionInputSchema,
      outputSchema: AppVersionDtoSchema,
      maxInputBytes: 256,
      maxOutputBytes: 256,
      authorize: () => true,
      handle: () => ({ version: app.getVersion() }),
    }),
  );

  return () => {
    ipcMain.removeHandler(APP_GET_VERSION_CHANNEL);
  };
};
