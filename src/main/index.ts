import { BrowserWindow, Menu, app, session } from 'electron';

import { registerIpcHandlers } from './ipc/register.js';
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
  disposeIpcHandlers = registerIpcHandlers({
    rendererLocation,
    getMainWindow: () => mainWindow,
  });
  openMainWindow(rendererLocation);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow(rendererLocation);
    }
  });
});
