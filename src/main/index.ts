import { BrowserWindow, Menu, app, dialog, session } from 'electron';

import {
  DESKTOP_IMPORT_LIMITS,
  PIPELINE_PROGRESS_CHANNEL,
  ProgressDtoSchema,
} from '../shared/ipc/import.js';
import { registerIpcHandlers } from './ipc/register.js';
import { createLocalProjectService } from './local-project-service.js';
import { resolveRendererLocation } from './renderer-location.js';
import { denyAllSessionPermissions, installWebContentsGuards } from './security.js';
import { createMainWindow } from './window.js';

let mainWindow: BrowserWindow | null = null;
let disposeIpcHandlers: (() => void) | null = null;

const openMainWindow = (
  rendererLocation: ReturnType<typeof resolveRendererLocation>,
): BrowserWindow => {
  const window = createMainWindow(rendererLocation);
  mainWindow = window;

  window.once('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
};

installWebContentsGuards(app);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.once('will-quit', () => {
  disposeIpcHandlers?.();
  disposeIpcHandlers = null;
});

void app.whenReady().then(() => {
  const developmentUrl = process.env['ELECTRON_RENDERER_URL'];
  const rendererLocation = resolveRendererLocation({
    productionUrl: new URL('../renderer/index.html', import.meta.url).href,
    ...(developmentUrl === undefined ? {} : { developmentUrl }),
  });

  denyAllSessionPermissions(session.defaultSession);

  Menu.setApplicationMenu(null);
  const importCapabilities = createLocalProjectService({
    storageRoot: app.getPath('userData'),
    dialog,
    getMainWindow: () => mainWindow,
    sendProgress: (progress) => {
      const parsed = ProgressDtoSchema.safeParse(progress);
      const encoded = parsed.success ? Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') : 0;

      if (
        parsed.success &&
        encoded <= DESKTOP_IMPORT_LIMITS.progressEventBytes &&
        mainWindow !== null &&
        !mainWindow.isDestroyed()
      ) {
        mainWindow.webContents.send(PIPELINE_PROGRESS_CHANNEL, parsed.data);
      }
    },
  });
  disposeIpcHandlers = registerIpcHandlers({
    rendererLocation,
    getMainWindow: () => mainWindow,
    importCapabilities,
  });
  openMainWindow(rendererLocation);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow(rendererLocation);
    }
  });
});
