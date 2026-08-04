import type { App, Event, Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  createSecureWebPreferences,
  denyAllSessionPermissions,
  hardenWebContents,
  installWebContentsGuards,
} from '../../src/main/security.js';

type RegisteredListener = (event: Event, ...args: unknown[]) => void;

const createPreventableEvent = (): Event =>
  ({
    preventDefault: vi.fn(),
  }) as unknown as Event;

describe('createSecureWebPreferences', () => {
  it('mantém isolamento e sandbox explícitos no pacote de produção', () => {
    expect(createSecureWebPreferences(true)).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      webviewTag: false,
    });
  });

  it('habilita DevTools somente fora do pacote sem reduzir os demais controles', () => {
    const development = createSecureWebPreferences(false);

    expect(development.devTools).toBe(true);
    expect(development).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });
});

describe('hardenWebContents', () => {
  it('nega webview, navegação principal, subframe, redirecionamento e popup', () => {
    const listeners = new Map<string, RegisteredListener>();
    let windowOpenHandler: ((details: unknown) => unknown) | undefined;
    const contents = {
      on: vi.fn((eventName: string, listener: RegisteredListener) => {
        listeners.set(eventName, listener);
        return contents;
      }),
      setWindowOpenHandler: vi.fn((handler: (details: unknown) => unknown) => {
        windowOpenHandler = handler;
      }),
    } as unknown as WebContents;

    hardenWebContents(contents);

    for (const eventName of [
      'will-attach-webview',
      'will-navigate',
      'will-frame-navigate',
      'will-redirect',
    ]) {
      const event = createPreventableEvent();
      const listener = listeners.get(eventName);

      expect(listener, `listener ausente para ${eventName}`).toBeTypeOf('function');
      listener?.(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }

    expect(windowOpenHandler?.({ url: 'https://malicioso.example' })).toEqual({
      action: 'deny',
    });
  });

  it('instala os guardas em todo WebContents criado pelo aplicativo', () => {
    let createdListener: ((_event: Event, contents: WebContents) => void) | undefined;
    const onContents = vi.fn();
    const setWindowOpenHandler = vi.fn();
    const electronApp = {
      on: vi.fn((eventName: string, listener: typeof createdListener) => {
        if (eventName === 'web-contents-created') {
          createdListener = listener;
        }
        return electronApp;
      }),
    } as unknown as Pick<App, 'on'>;
    const contents = {
      on: onContents.mockImplementation(() => contents),
      setWindowOpenHandler,
    } as unknown as WebContents;

    installWebContentsGuards(electronApp);
    createdListener?.(createPreventableEvent(), contents);

    expect(onContents).toHaveBeenCalledWith('will-attach-webview', expect.any(Function));
    expect(onContents).toHaveBeenCalledWith('will-navigate', expect.any(Function));
    expect(onContents).toHaveBeenCalledWith('will-frame-navigate', expect.any(Function));
    expect(onContents).toHaveBeenCalledWith('will-redirect', expect.any(Function));
    expect(setWindowOpenHandler).toHaveBeenCalledOnce();
  });
});

describe('denyAllSessionPermissions', () => {
  it('nega verificações e solicitações de permissão por padrão', () => {
    let checkHandler: (() => boolean) | undefined;
    let requestHandler:
      | ((
          _contents: WebContents,
          _permission: string,
          callback: (allowed: boolean) => void,
        ) => void)
      | undefined;
    const targetSession = {
      setPermissionCheckHandler: vi.fn((handler: typeof checkHandler) => {
        checkHandler = handler;
      }),
      setPermissionRequestHandler: vi.fn((handler: typeof requestHandler) => {
        requestHandler = handler;
      }),
    } as unknown as Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>;
    const callback = vi.fn();

    denyAllSessionPermissions(targetSession);

    expect(checkHandler?.()).toBe(false);
    requestHandler?.({} as WebContents, 'notifications', callback);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(false);
  });
});
