import type { BrowserWindow, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  getVersion: vi.fn(() => '0.1.0'),
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: electronMocks.getVersion,
  },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

import { registerIpcHandlers } from '../../src/main/ipc/register.js';
import { resolveRendererLocation } from '../../src/main/renderer-location.js';
import {
  APP_GET_VERSION_CHANNEL,
  APP_GET_VERSION_INPUT,
} from '../../src/shared/ipc/desktop-api.js';

describe('registerIpcHandlers', () => {
  it('registra e remove somente a capacidade nomeada permitida', async () => {
    const rendererLocation = resolveRendererLocation({
      productionUrl: 'file:///app/out/renderer/index.html',
    });
    const frame = {
      isDestroyed: () => false,
      url: rendererLocation.url,
    } as WebFrameMain;
    const webContents = {
      mainFrame: frame,
    } as WebContents;
    const event = {
      sender: webContents,
      senderFrame: frame,
    } as Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>;
    const mainWindow = {
      webContents,
    } as BrowserWindow;

    const dispose = registerIpcHandlers({
      rendererLocation,
      getMainWindow: () => mainWindow,
    });

    expect(electronMocks.handle).toHaveBeenCalledOnce();
    expect(electronMocks.handle).toHaveBeenCalledWith(
      APP_GET_VERSION_CHANNEL,
      expect.any(Function),
    );

    const registeredHandler = electronMocks.handle.mock.calls[0]?.[1] as
      | ((
          invokeEvent: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
          payload: unknown,
        ) => Promise<unknown>)
      | undefined;

    await expect(registeredHandler?.(event, APP_GET_VERSION_INPUT)).resolves.toEqual({
      ok: true,
      value: { version: '0.1.0' },
    });

    dispose();

    expect(electronMocks.removeHandler).toHaveBeenCalledOnce();
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(APP_GET_VERSION_CHANNEL);
  });
});
