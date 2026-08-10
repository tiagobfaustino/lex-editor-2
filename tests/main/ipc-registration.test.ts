import type { BrowserWindow, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  registerIpcHandlers,
  type DesktopImportIpcCapabilities,
} from '../../src/main/ipc/register.js';
import { PlanaltoNetworkError } from '../../src/main/import/planalto-source.js';
import { resolveRendererLocation } from '../../src/main/renderer-location.js';
import {
  APP_GET_VERSION_CHANNEL,
  APP_GET_VERSION_INPUT,
} from '../../src/shared/ipc/desktop-api.js';
import {
  DIAGNOSTICS_GET_PAGE_CHANNEL,
  EXPORT_CHOOSE_DESTINATION_CHANNEL,
  EXPORT_WRITE_CHANNEL,
  PIPELINE_CANCEL_CHANNEL,
  PIPELINE_START_CHANNEL,
  PREVIEW_GET_DOCUMENT_CHANNEL,
  PREVIEW_GET_PAGE_CHANNEL,
  PREVIEW_REVEAL_NODE_CHANNEL,
  SOURCE_SELECT_LOCAL_CHANNEL,
  SOURCE_IMPORT_URL_CHANNEL,
} from '../../src/shared/ipc/import.js';
import type { SourceSummaryDto } from '../../src/shared/ipc/import.js';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const DESTINATION_ID = '44444444-4444-4444-8444-444444444444';

const source: SourceSummaryDto = {
  sourceId: SOURCE_ID,
  sourceKind: 'local_html',
  displayName: 'codigo-penal.html',
  mediaType: 'text/html',
  byteLength: 1_024,
  sourceArtifactSha256: 'a'.repeat(64),
};

const capabilities = (): DesktopImportIpcCapabilities => ({
  selectLocal: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => source),
  },
  importFromUrl: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ ...source, sourceKind: 'planalto_url' as const })),
  },
  startProcessing: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ jobId: JOB_ID, projectId: PROJECT_ID })),
  },
  cancelJob: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ jobId: JOB_ID, cancelled: true })),
  },
  getPreviewDocument: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => {
      throw new Error('not used');
    }),
  },
  getPreviewPage: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ items: [], nextCursor: null, totalItems: 0 })),
  },
  revealPreviewNode: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ items: [] })),
  },
  getDiagnosticPage: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ items: [], nextCursor: null, totalItems: 0 })),
  },
  chooseExportDestination: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ destinationId: DESTINATION_ID, displayName: 'Documentos' })),
  },
  writeExport: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      projectId: PROJECT_ID,
      destinationId: DESTINATION_ID,
      fileName: 'codigo-penal.md',
      byteLength: 2_048,
      markdownSha256: 'b'.repeat(64),
    })),
  },
});

type InvokeHandler = (
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  payload: unknown,
) => Promise<unknown>;

const setup = (importCapabilities = capabilities()) => {
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
    importCapabilities,
  });
  const handlers = new Map<string, InvokeHandler>(
    electronMocks.handle.mock.calls.map(([channel, handler]) => [
      channel as string,
      handler as InvokeHandler,
    ]),
  );

  return { dispose, event, frame, handlers, importCapabilities };
};

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registra, executa e remove somente capacidades nomeadas', async () => {
    const { dispose, event, handlers } = setup();
    const expectedChannels = [
      APP_GET_VERSION_CHANNEL,
      SOURCE_SELECT_LOCAL_CHANNEL,
      SOURCE_IMPORT_URL_CHANNEL,
      PIPELINE_START_CHANNEL,
      PIPELINE_CANCEL_CHANNEL,
      PREVIEW_GET_DOCUMENT_CHANNEL,
      PREVIEW_GET_PAGE_CHANNEL,
      PREVIEW_REVEAL_NODE_CHANNEL,
      DIAGNOSTICS_GET_PAGE_CHANNEL,
      EXPORT_CHOOSE_DESTINATION_CHANNEL,
      EXPORT_WRITE_CHANNEL,
    ];

    expect([...handlers.keys()]).toEqual(expectedChannels);
    await expect(
      handlers.get(APP_GET_VERSION_CHANNEL)?.(event, APP_GET_VERSION_INPUT),
    ).resolves.toEqual({ ok: true, value: { version: '0.1.0' } });
    await expect(handlers.get(SOURCE_SELECT_LOCAL_CHANNEL)?.(event, {})).resolves.toEqual({
      ok: true,
      value: source,
    });
    await expect(
      handlers.get(SOURCE_IMPORT_URL_CHANNEL)?.(event, {
        url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm',
      }),
    ).resolves.toMatchObject({ ok: true, value: { sourceKind: 'planalto_url' } });
    await expect(
      handlers.get(PIPELINE_START_CHANNEL)?.(event, { sourceId: SOURCE_ID }),
    ).resolves.toEqual({ ok: true, value: { jobId: JOB_ID, projectId: PROJECT_ID } });
    await expect(
      handlers.get(EXPORT_CHOOSE_DESTINATION_CHANNEL)?.(event, { projectId: PROJECT_ID }),
    ).resolves.toEqual({
      ok: true,
      value: { destinationId: DESTINATION_ID, displayName: 'Documentos' },
    });
    await expect(
      handlers.get(EXPORT_WRITE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        destinationId: DESTINATION_ID,
      }),
    ).resolves.toMatchObject({ ok: true, value: { fileName: 'codigo-penal.md' } });

    dispose();

    const removedChannels = (
      electronMocks.removeHandler.mock.calls as unknown as readonly [string][]
    ).map(([channel]) => channel);

    expect(removedChannels).toEqual(expectedChannels);
  });

  it('nega remetente forjado, payload extra e operação não autorizada antes do efeito', async () => {
    const defaults = capabilities();
    const importCapabilities: DesktopImportIpcCapabilities = {
      ...defaults,
      writeExport: {
        ...defaults.writeExport,
        authorize: vi.fn(() => false),
      },
    };
    const { event, handlers, frame } = setup(importCapabilities);
    const forgedFrame = {
      isDestroyed: () => false,
      url: 'file:///tmp/forged.html',
    } as WebFrameMain;
    const forgedEvent = { ...event, senderFrame: forgedFrame };

    await expect(
      handlers.get(SOURCE_SELECT_LOCAL_CHANNEL)?.(forgedEvent, {}),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    await expect(
      handlers.get(SOURCE_IMPORT_URL_CHANNEL)?.(forgedEvent, {
        url: 'https://www.planalto.gov.br/lei.htm',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    await expect(
      handlers.get(PIPELINE_START_CHANNEL)?.(event, {
        sourceId: SOURCE_ID,
        path: '/etc/passwd',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(
      handlers.get(EXPORT_WRITE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        destinationId: DESTINATION_ID,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });

    expect(importCapabilities.selectLocal.handle).not.toHaveBeenCalled();
    expect(importCapabilities.importFromUrl.handle).not.toHaveBeenCalled();
    expect(importCapabilities.startProcessing.handle).not.toHaveBeenCalled();
    expect(importCapabilities.writeExport.handle).not.toHaveBeenCalled();
    expect(event.sender.mainFrame).toBe(frame);
  });

  it('recusa saída privilegiada fora do schema e redige falha interna', async () => {
    const defaults = capabilities();
    const importCapabilities: DesktopImportIpcCapabilities = {
      ...defaults,
      selectLocal: {
        ...defaults.selectLocal,
        handle: vi.fn(() => ({ ...source, path: '/home/editor/segredo.html' }) as SourceSummaryDto),
      },
      startProcessing: {
        ...defaults.startProcessing,
        handle: vi.fn(() => {
          throw new Error('token-secreto-no-main');
        }),
      },
    };
    const { event, handlers } = setup(importCapabilities);

    const leaked = await handlers.get(SOURCE_SELECT_LOCAL_CHANNEL)?.(event, {});
    const failed = await handlers.get(PIPELINE_START_CHANNEL)?.(event, { sourceId: SOURCE_ID });

    expect(leaked).toMatchObject({ ok: false, error: { code: 'FAILED' } });
    expect(failed).toMatchObject({ ok: false, error: { code: 'FAILED' } });
    expect(JSON.stringify([leaked, failed])).not.toMatch(/segredo|token|\/home\//iu);
  });

  it('preserva somente o código e a mensagem segura de falhas de rede conhecidas', async () => {
    const defaults = capabilities();
    const importCapabilities: DesktopImportIpcCapabilities = {
      ...defaults,
      importFromUrl: {
        ...defaults.importFromUrl,
        handle: vi.fn(() => {
          throw new PlanaltoNetworkError('NETWORK_TIMEOUT');
        }),
      },
    };
    const { event, handlers } = setup(importCapabilities);

    await expect(
      handlers.get(SOURCE_IMPORT_URL_CHANNEL)?.(event, {
        url: 'https://www.planalto.gov.br/lei.htm',
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'NETWORK_TIMEOUT',
        message: 'Não foi possível acessar a fonte: tempo esgotado.',
        retryable: true,
      },
    });
  });

  it('mantém capacidades sem serviço concreto em falha explícita', async () => {
    const rendererLocation = resolveRendererLocation({
      productionUrl: 'file:///app/out/renderer/index.html',
    });
    const frame = { isDestroyed: () => false, url: rendererLocation.url } as WebFrameMain;
    const webContents = { mainFrame: frame } as WebContents;
    const event = { sender: webContents, senderFrame: frame } as Pick<
      IpcMainInvokeEvent,
      'sender' | 'senderFrame'
    >;

    registerIpcHandlers({
      rendererLocation,
      getMainWindow: () => ({ webContents }) as BrowserWindow,
    });
    const handler = electronMocks.handle.mock.calls.find(
      ([channel]) => channel === SOURCE_SELECT_LOCAL_CHANNEL,
    )?.[1] as InvokeHandler | undefined;

    await expect(handler?.(event, {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'FAILED', retryable: true },
    });
  });
});
