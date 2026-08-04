import { BrowserWindow, app, dialog } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';

import type { RendererLocation } from './renderer-location.js';
import { createSecureWebPreferences } from './security.js';

const loadRenderer = async (
  window: BrowserWindow,
  rendererLocation: RendererLocation,
): Promise<void> => {
  if (rendererLocation.kind === 'development') {
    await window.loadURL(rendererLocation.url);
    return;
  }

  await window.loadFile(fileURLToPath(rendererLocation.url));
};

export const createMainWindow = (rendererLocation: RendererLocation): BrowserWindow => {
  const options: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    webPreferences: {
      ...createSecureWebPreferences(app.isPackaged),
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
    },
  };

  const window = new BrowserWindow(options);

  window.once('ready-to-show', () => {
    window.show();
  });

  void loadRenderer(window, rendererLocation).catch(() => {
    dialog.showErrorBox(
      'Falha ao iniciar o Lex Editor',
      'Não foi possível carregar a interface local do aplicativo.',
    );
    window.destroy();
    app.quit();
  });

  return window;
};
