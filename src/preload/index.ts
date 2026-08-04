import { contextBridge, ipcRenderer } from 'electron';

import {
  APP_GET_VERSION_CHANNEL,
  APP_GET_VERSION_INPUT,
  AppGetVersionResultSchema,
  DESKTOP_API_VERSION,
  DESKTOP_CAPABILITIES,
  createFailedResult,
} from '../shared/ipc/desktop-api.js';
import type { AppGetVersionResult, LexDesktopApiV1 } from '../shared/ipc/desktop-api.js';

const getVersion = async (): Promise<AppGetVersionResult> => {
  try {
    const rawResult: unknown = await ipcRenderer.invoke(
      APP_GET_VERSION_CHANNEL,
      APP_GET_VERSION_INPUT,
    );
    const parsedResult = AppGetVersionResultSchema.safeParse(rawResult);

    return parsedResult.success ? parsedResult.data : createFailedResult('FAILED');
  } catch {
    return createFailedResult('FAILED');
  }
};

const desktopApi: LexDesktopApiV1 = Object.freeze({
  version: DESKTOP_API_VERSION,
  capabilities: DESKTOP_CAPABILITIES,
  app: Object.freeze({
    getVersion,
  }),
});

contextBridge.exposeInMainWorld('lexDesktop', desktopApi);
