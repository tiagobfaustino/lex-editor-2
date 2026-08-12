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
  EDITORIAL_GET_STATE_CHANNEL,
  EDITORIAL_VALIDATE_CHANNEL,
} from '../../src/shared/ipc/editorial.js';
import {
  EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL,
  EXPORT_CHOOSE_DESTINATION_CHANNEL,
  EXPORT_WRITE_BATCH_CHANNEL,
  EXPORT_WRITE_CHANNEL,
  PIPELINE_START_CHANNEL,
  PREVIEW_GET_LEGAL_REFERENCE_CHANNEL,
  PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL,
  PREVIEW_SET_PROJECTION_PROFILE_CHANNEL,
  SOURCE_SELECT_LOCAL_CHANNEL,
  SOURCE_IMPORT_URL_CHANNEL,
} from '../../src/shared/ipc/import.js';
import { UPDATES_GET_COUNTS_CHANNEL, UPDATES_LIST_CHANNEL } from '../../src/shared/ipc/updates.js';
import '../../src/preload/index.js';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const DESTINATION_ID = '44444444-4444-4444-8444-444444444444';
const REFERENCE_ID = 'a'.repeat(64);

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
        case EDITORIAL_GET_STATE_CHANNEL:
        case EDITORIAL_VALIDATE_CHANNEL:
          return {
            ok: true,
            value: {
              projectId: PROJECT_ID,
              revisionHash: 'c'.repeat(64),
              journalSequence: 0,
              saveState: 'saved',
              validatedAt: '2026-08-10T13:00:00.000-03:00',
              validationMode: 'full',
              validationIsComplete: true,
              blockingCount: 0,
              warningCount: 0,
              unconfirmedWarningCount: 0,
              reviewApprovalStatus: 'not_approved',
              canApprove: true,
              canExport: false,
              diagnostics: [],
              reviewTargets: [],
            },
          };
        case PREVIEW_SET_PROJECTION_PROFILE_CHANNEL:
          return {
            ok: true,
            value: { projectId: PROJECT_ID, projectionProfile: 'current_only' },
          };
        case PREVIEW_GET_LEGAL_REFERENCE_CHANNEL:
          return {
            ok: true,
            value: {
              referenceId: REFERENCE_ID,
              targetTitle: 'Constituição Federal de 1988',
              targetSigla: 'cf88',
              targetLegalPath: 'Art. 37',
              targetDeviceStatus: 'active',
              targetPlainText: 'A administração pública obedecerá aos princípios legais.',
              external: true,
            },
          };
        case PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL:
          return {
            ok: true,
            value: {
              targetProjectId: PROJECT_ID,
              targetPreviewNodeId: SOURCE_ID,
              external: true,
            },
          };
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
              projectionProfile: 'complete_with_history',
              fileName: 'codigo-penal.md',
              byteLength: 2_048,
              markdownSha256: 'b'.repeat(64),
            },
          };
        case EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL:
          return {
            ok: true,
            value: { destinationId: DESTINATION_ID, displayName: 'Documentos' },
          };
        case EXPORT_WRITE_BATCH_CHANNEL:
          return {
            ok: true,
            value: {
              destinationId: DESTINATION_ID,
              total: 1,
              succeeded: 1,
              failed: 0,
              results: [
                {
                  projectId: PROJECT_ID,
                  title: 'Código Penal',
                  sigla: 'cp',
                  batchExportStatus: 'succeeded',
                  directoryName: 'codigo-penal',
                  markdownFileName: 'cp.md',
                  updateFileName: 'UPDATE.md',
                  markdownSha256: 'b'.repeat(64),
                  updateSha256: 'd'.repeat(64),
                },
              ],
            },
          };
        case UPDATES_LIST_CHANNEL:
          return { ok: true, value: { items: [], nextCursor: null } };
        case UPDATES_GET_COUNTS_CHANNEL:
          return {
            ok: true,
            value: {
              pending: 0,
              approved: 0,
              rejected: 0,
              superseded: 0,
              error: 0,
              actionable: 0,
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
      'editorial',
      'export',
      'pipeline',
      'preview',
      'publication',
      'source',
      'updates',
      'version',
    ]);
    expect(Object.keys(api.source)).toEqual(['selectLocal', 'importFromUrl']);
    expect(Object.keys(api.pipeline)).toEqual(['start', 'cancel', 'onProgress']);
    expect(Object.keys(api.preview)).toEqual([
      'getDocument',
      'getPage',
      'revealNode',
      'setProjectionProfile',
      'getLegalReference',
      'navigateLegalReference',
    ]);
    expect(Object.keys(api.diagnostics)).toEqual(['getPage']);
    expect(Object.keys(api.editorial)).toEqual([
      'getState',
      'correctText',
      'confirmInterpretation',
      'confirmWarning',
      'validate',
      'approve',
    ]);
    expect(Object.keys(api.export).sort()).toEqual([
      'chooseBatchDestination',
      'chooseDestination',
      'write',
      'writeBatch',
    ]);
    expect(Object.keys(api.publication)).toEqual([
      'prepare',
      'execute',
      'getAttempt',
      'retry',
      'listHistory',
      'getDiff',
      'prepareRollback',
    ]);
    expect(Object.keys(api.updates)).toEqual([
      'list',
      'getDetail',
      'getCounts',
      'approve',
      'reject',
      'reprocess',
    ]);
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
    await expect(api.editorial.getState({ projectId: PROJECT_ID })).resolves.toMatchObject({
      ok: true,
      value: { canApprove: true },
    });
    await expect(api.editorial.validate({ projectId: PROJECT_ID })).resolves.toMatchObject({
      ok: true,
      value: { validationMode: 'full' },
    });
    await expect(
      api.preview.setProjectionProfile({
        projectId: PROJECT_ID,
        projectionProfile: 'current_only',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      api.preview.getLegalReference({ projectId: PROJECT_ID, referenceId: REFERENCE_ID }),
    ).resolves.toMatchObject({ ok: true, value: { targetLegalPath: 'Art. 37' } });
    await expect(
      api.preview.navigateLegalReference({ projectId: PROJECT_ID, referenceId: REFERENCE_ID }),
    ).resolves.toMatchObject({ ok: true, value: { targetPreviewNodeId: SOURCE_ID } });
    await expect(
      api.export.chooseDestination({
        projectId: PROJECT_ID,
        projectionProfile: 'complete_with_history',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      api.export.write({ projectId: PROJECT_ID, destinationId: DESTINATION_ID }),
    ).resolves.toMatchObject({ ok: true, value: { fileName: 'codigo-penal.md' } });
    await expect(
      api.export.chooseBatchDestination({ projectIds: [PROJECT_ID] }),
    ).resolves.toMatchObject({ ok: true });
    await expect(api.export.writeBatch({ destinationId: DESTINATION_ID })).resolves.toMatchObject({
      ok: true,
      value: { succeeded: 1 },
    });
    await expect(
      api.updates.list({ updateReviewStatus: null, cursor: null, limit: 100 }),
    ).resolves.toMatchObject({ ok: true, value: { items: [] } });
    await expect(api.updates.getCounts({})).resolves.toMatchObject({
      ok: true,
      value: { actionable: 0 },
    });

    expect(electronMocks.invoke.mock.calls).toEqual([
      [APP_GET_VERSION_CHANNEL, {}],
      [SOURCE_SELECT_LOCAL_CHANNEL, {}],
      [
        SOURCE_IMPORT_URL_CHANNEL,
        { url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm' },
      ],
      [PIPELINE_START_CHANNEL, { sourceId: SOURCE_ID }],
      [EDITORIAL_GET_STATE_CHANNEL, { projectId: PROJECT_ID }],
      [EDITORIAL_VALIDATE_CHANNEL, { projectId: PROJECT_ID }],
      [
        PREVIEW_SET_PROJECTION_PROFILE_CHANNEL,
        { projectId: PROJECT_ID, projectionProfile: 'current_only' },
      ],
      [PREVIEW_GET_LEGAL_REFERENCE_CHANNEL, { projectId: PROJECT_ID, referenceId: REFERENCE_ID }],
      [
        PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL,
        { projectId: PROJECT_ID, referenceId: REFERENCE_ID },
      ],
      [
        EXPORT_CHOOSE_DESTINATION_CHANNEL,
        { projectId: PROJECT_ID, projectionProfile: 'complete_with_history' },
      ],
      [EXPORT_WRITE_CHANNEL, { projectId: PROJECT_ID, destinationId: DESTINATION_ID }],
      [EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL, { projectIds: [PROJECT_ID] }],
      [EXPORT_WRITE_BATCH_CHANNEL, { destinationId: DESTINATION_ID }],
      [UPDATES_LIST_CHANNEL, { updateReviewStatus: null, cursor: null, limit: 100 }],
      [UPDATES_GET_COUNTS_CHANNEL, {}],
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
    const forgedReference = api.preview.getLegalReference as (input: unknown) => Promise<unknown>;

    await expect(forgedStart({ sourceId: SOURCE_ID, path: '/etc/passwd' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    await expect(
      forgedReference({ projectId: PROJECT_ID, referenceId: 'not-a-hash', path: '/etc/passwd' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });
});
