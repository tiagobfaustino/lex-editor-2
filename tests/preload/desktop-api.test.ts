import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const exposed: { name?: string; api?: unknown } = {};

  return {
    exposed,
    exposeInMainWorld: vi.fn((name: string, api: unknown) => {
      exposed.name = name;
      exposed.api = api;
    }),
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

import type { LexDesktopApiV1 } from '../../src/shared/ipc/desktop-api.js';
import { APP_GET_VERSION_CHANNEL, DESKTOP_CAPABILITIES } from '../../src/shared/ipc/desktop-api.js';
import {
  EXPORT_CHOOSE_DESTINATION_CHANNEL,
  EXPORT_WRITE_CHANNEL,
  PIPELINE_START_CHANNEL,
  SOURCE_SELECT_LOCAL_CHANNEL,
  SOURCE_IMPORT_URL_CHANNEL,
} from '../../src/shared/ipc/import.js';
import '../../src/preload/index.js';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const DESTINATION_ID = '44444444-4444-4444-8444-444444444444';

const exposedApi = (): LexDesktopApiV1 => {
  if (electronMocks.exposed.name !== 'lexDesktop') {
    throw new Error('A API desktop não foi exposta.');
  }

  return electronMocks.exposed.api as LexDesktopApiV1;
};

describe('preload desktop API', () => {
  beforeEach(() => {
    electronMocks.invoke.mockReset();
    electronMocks.invoke.mockImplementation((channel: string) => {
      switch (channel) {
        case APP_GET_VERSION_CHANNEL:
          return { ok: true, value: { version: '0.1.0' } };
        case SOURCE_SELECT_LOCAL_CHANNEL:
          return {
            ok: true,
            value: {
              sourceId: SOURCE_ID,
              sourceKind: 'local_html',
              displayName: 'codigo-penal.html',
              mediaType: 'text/html',
              byteLength: 1_024,
              sourceArtifactSha256: 'a'.repeat(64),
            },
          };
        case SOURCE_IMPORT_URL_CHANNEL:
          return {
            ok: true,
            value: {
              sourceId: SOURCE_ID,
              sourceKind: 'planalto_url',
              displayName: 'codigo-penal.html',
              mediaType: 'text/html',
              byteLength: 1_024,
              sourceArtifactSha256: 'a'.repeat(64),
            },
          };
        case PIPELINE_START_CHANNEL:
          return { ok: true, value: { jobId: JOB_ID, projectId: PROJECT_ID } };
        case EXPORT_CHOOSE_DESTINATION_CHANNEL:
          return {
            ok: true,
            value: { destinationId: DESTINATION_ID, displayName: 'Documentos' },
          };
        case EXPORT_WRITE_CHANNEL:
          return {
            ok: true,
            value: {
              projectId: PROJECT_ID,
              destinationId: DESTINATION_ID,
              fileName: 'codigo-penal.md',
              byteLength: 2_048,
              markdownSha256: 'b'.repeat(64),
            },
          };
        default:
          throw new Error('Canal inesperado.');
      }
    });
  });

  it('expõe somente métodos nomeados e a allowlist declarada', () => {
    const api = exposedApi();

    expect(api.capabilities).toBe(DESKTOP_CAPABILITIES);
    expect(Object.keys(api).sort()).toEqual([
      'app',
      'capabilities',
      'diagnostics',
      'export',
      'pipeline',
      'preview',
      'source',
      'version',
    ]);
    expect(Object.keys(api.source)).toEqual(['selectLocal', 'importFromUrl']);
    expect(Object.keys(api.pipeline)).toEqual(['start', 'cancel', 'onProgress']);
    expect(Object.keys(api.preview)).toEqual(['getDocument', 'getPage', 'revealNode']);
    expect(Object.keys(api.diagnostics)).toEqual(['getPage']);
    expect(Object.keys(api.export).sort()).toEqual(['chooseDestination', 'write']);
    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api).not.toHaveProperty('invoke');
  });

  it('invoca apenas canais fixos com payload mínimo', async () => {
    const api = exposedApi();

    await expect(api.app.getVersion()).resolves.toMatchObject({ ok: true });
    await expect(api.source.selectLocal()).resolves.toMatchObject({ ok: true });
    await expect(
      api.source.importFromUrl({
        url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(api.pipeline.start({ sourceId: SOURCE_ID })).resolves.toEqual({
      ok: true,
      value: { jobId: JOB_ID, projectId: PROJECT_ID },
    });
    await expect(api.export.chooseDestination({ projectId: PROJECT_ID })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      api.export.write({ projectId: PROJECT_ID, destinationId: DESTINATION_ID }),
    ).resolves.toMatchObject({ ok: true, value: { fileName: 'codigo-penal.md' } });

    expect(electronMocks.invoke.mock.calls).toEqual([
      [APP_GET_VERSION_CHANNEL, {}],
      [SOURCE_SELECT_LOCAL_CHANNEL, {}],
      [
        SOURCE_IMPORT_URL_CHANNEL,
        { url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm' },
      ],
      [PIPELINE_START_CHANNEL, { sourceId: SOURCE_ID }],
      [EXPORT_CHOOSE_DESTINATION_CHANNEL, { projectId: PROJECT_ID }],
      [EXPORT_WRITE_CHANNEL, { projectId: PROJECT_ID, destinationId: DESTINATION_ID }],
    ]);
  });

  it('converte exceção ou resposta fora do schema em erro sanitizado', async () => {
    const api = exposedApi();
    electronMocks.invoke
      .mockRejectedValueOnce(new Error('/home/editor/segredo.html'))
      .mockResolvedValueOnce({ ok: true, value: { jobId: 'não-é-uuid' } });

    const failedSelection = await api.source.selectLocal();
    const failedPipeline = await api.pipeline.start({ sourceId: SOURCE_ID });

    expect(failedSelection).toEqual(failedPipeline);
    expect(failedSelection).toEqual({
      ok: false,
      error: {
        code: 'FAILED',
        message: 'A operação desktop não pôde ser concluída.',
        retryable: true,
      },
    });
    expect(JSON.stringify([failedSelection, failedPipeline])).not.toMatch(/segredo|\/home\//iu);
  });

  it('rejeita payload forjado no preload sem alcançar o canal', async () => {
    const api = exposedApi();
    const forgedStart = api.pipeline.start as (input: unknown) => Promise<unknown>;

    await expect(forgedStart({ sourceId: SOURCE_ID, path: '/etc/passwd' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });
});
