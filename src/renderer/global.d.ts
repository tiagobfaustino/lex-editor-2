import type { LexDesktopApiV1 } from '../shared/ipc/desktop-api';

declare global {
  interface Window {
    lexDesktop?: LexDesktopApiV1;
  }
}

export {};
