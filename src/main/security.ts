import type { App, Session, WebContents, WebPreferences } from 'electron';

type AppEventRegistrar = Pick<App, 'on'>;
type PermissionSession = Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>;

export const createSecureWebPreferences = (isPackaged: boolean): Readonly<WebPreferences> =>
  Object.freeze({
    allowRunningInsecureContent: false,
    contextIsolation: true,
    devTools: !isPackaged,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    webSecurity: true,
    webviewTag: false,
  });

export const hardenWebContents = (contents: WebContents): void => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  contents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  contents.on('will-frame-navigate', (event) => {
    event.preventDefault();
  });

  contents.on('will-redirect', (event) => {
    event.preventDefault();
  });

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
};

export const installWebContentsGuards = (electronApp: AppEventRegistrar): void => {
  electronApp.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents);
  });
};

export const denyAllSessionPermissions = (targetSession: PermissionSession): void => {
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
};
