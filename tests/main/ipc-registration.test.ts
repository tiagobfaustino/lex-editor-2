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
  type DesktopSourceCatalogIpcCapabilities,
  type DesktopUpdateIpcCapabilities,
} from '../../src/main/ipc/register.js';
import { PlanaltoNetworkError } from '../../src/main/import/planalto-source.js';
import { DesktopIpcError } from '../../src/main/ipc/validated-handler.js';
import { resolveRendererLocation } from '../../src/main/renderer-location.js';
import {
  APP_GET_VERSION_CHANNEL,
  APP_GET_VERSION_INPUT,
} from '../../src/shared/ipc/desktop-api.js';
import {
  EDITORIAL_APPROVE_CHANNEL,
  EDITORIAL_CONFIRM_INTERPRETATION_CHANNEL,
  EDITORIAL_CONFIRM_WARNING_CHANNEL,
  EDITORIAL_CORRECT_TEXT_CHANNEL,
  EDITORIAL_GET_STATE_CHANNEL,
  EDITORIAL_VALIDATE_CHANNEL,
  type EditorialStateDto,
} from '../../src/shared/ipc/editorial.js';
import {
  DIAGNOSTICS_GET_PAGE_CHANNEL,
  EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL,
  EXPORT_CHOOSE_DESTINATION_CHANNEL,
  EXPORT_WRITE_BATCH_CHANNEL,
  EXPORT_WRITE_CHANNEL,
  PIPELINE_CANCEL_CHANNEL,
  PIPELINE_START_CHANNEL,
  PREVIEW_GET_DOCUMENT_CHANNEL,
  PREVIEW_GET_LEGAL_REFERENCE_CHANNEL,
  PREVIEW_GET_PAGE_CHANNEL,
  PREVIEW_REVEAL_NODE_CHANNEL,
  PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL,
  PREVIEW_SET_PROJECTION_PROFILE_CHANNEL,
  SOURCE_SELECT_LOCAL_CHANNEL,
  SOURCE_IMPORT_URL_CHANNEL,
} from '../../src/shared/ipc/import.js';
import type { SourceSummaryDto } from '../../src/shared/ipc/import.js';
import {
  REPROCESSING_GET_STATE_CHANNEL,
  REPROCESSING_REQUEST_CHANNEL,
} from '../../src/shared/ipc/reprocessing.js';
import {
  AUDIT_GET_DETAIL_CHANNEL,
  AUDIT_GET_INCIDENT_CHANNEL,
  AUDIT_GET_TIMELINE_CHANNEL,
  AUDIT_OPEN_EVIDENCE_CHANNEL,
  AUDIT_QUERY_CHANNEL,
  AUDIT_RECORD_INCIDENT_NOTE_CHANNEL,
} from '../../src/shared/ipc/audit.js';
import {
  METADATA_GET_STATE_CHANNEL,
  METADATA_UPDATE_CHANNEL,
  type MetadataStateDto,
} from '../../src/shared/ipc/metadata.js';
import {
  PUBLICATION_EXECUTE_CHANNEL,
  PUBLICATION_GET_ATTEMPT_CHANNEL,
  PUBLICATION_GET_DIFF_CHANNEL,
  PUBLICATION_LIST_HISTORY_CHANNEL,
  PUBLICATION_PREPARE_CHANNEL,
  PUBLICATION_PREPARE_ROLLBACK_CHANNEL,
  PUBLICATION_RETRY_CHANNEL,
} from '../../src/shared/ipc/publication.js';
import {
  UPDATES_APPROVE_CHANNEL,
  UPDATES_GET_COUNTS_CHANNEL,
  UPDATES_GET_DETAIL_CHANNEL,
  UPDATES_LIST_CHANNEL,
  UPDATES_REJECT_CHANNEL,
  UPDATES_REPROCESS_CHANNEL,
} from '../../src/shared/ipc/updates.js';
import {
  SOURCES_ACTIVATE_CHANNEL,
  SOURCES_ARCHIVE_CHANNEL,
  SOURCES_CREATE_BINDING_REVISION_CHANNEL,
  SOURCES_CREATE_PROVIDER_REVISION_CHANNEL,
  SOURCES_DRY_RUN_CHANNEL,
  SOURCES_LIST_CHANNEL,
  SOURCES_PAUSE_CHANNEL,
  SOURCES_REQUEST_CHECK_CHANNEL,
  SOURCES_RESTORE_CHANNEL,
} from '../../src/shared/ipc/sources.js';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const DESTINATION_ID = '44444444-4444-4444-8444-444444444444';
const UPDATE_ID = '55555555-5555-4555-8555-555555555555';
const REFERENCE_ID = 'a'.repeat(64);
const TEST_EVIDENCE_ID = '66666666-6666-4666-8666-666666666666';
const REQUEST_ID = '77777777-7777-4777-8777-777777777777';

const source: SourceSummaryDto = {
  sourceId: SOURCE_ID,
  sourceKind: 'local_html',
  displayName: 'codigo-penal.html',
  mediaType: 'text/html',
  byteLength: 1_024,
  sourceArtifactSha256: 'a'.repeat(64),
};

const editorialState: EditorialStateDto = {
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
};

const editableField = <Value>(
  value: Value,
  origin: 'import' | 'official_source' | 'editorial',
) => ({
  value,
  origin,
  mutability: 'editable' as const,
  editable: true,
  blockedReason: null,
});
const readOnlyField = <Value>(
  value: Value,
  origin:
    | 'source_catalog'
    | 'formatter'
    | 'ast_structure'
    | 'publication'
    | 'projection'
    | 'reference_catalog'
    | 'reconciliation',
) => ({
  value,
  origin,
  mutability: 'read_only' as const,
  editable: false,
  blockedReason:
    origin === 'source_catalog' ? ('source_managed' as const) : ('system_managed' as const),
});
const metadataState: MetadataStateDto = {
  projectId: PROJECT_ID,
  revisionHash: 'c'.repeat(64),
  journalSequence: 0,
  publicationHistoryState: 'unknown',
  fields: {
    titulo: editableField('Código Penal', 'import'),
    sigla: {
      value: 'cp',
      origin: 'import',
      mutability: 'prepublication_only',
      editable: false,
      blockedReason: 'publication_history_unknown',
    },
    tipoNorma: {
      value: 'código',
      origin: 'import',
      mutability: 'prepublication_only',
      editable: false,
      blockedReason: 'publication_history_unknown',
    },
    numero: {
      value: '2848',
      origin: 'official_source',
      mutability: 'prepublication_only',
      editable: false,
      blockedReason: 'publication_history_unknown',
    },
    ano: {
      value: 1940,
      origin: 'official_source',
      mutability: 'prepublication_only',
      editable: false,
      blockedReason: 'publication_history_unknown',
    },
    ramo: editableField('direito penal', 'editorial'),
    fonte: readOnlyField('https://www.planalto.gov.br/', 'source_catalog'),
    dataPublicacao: editableField('1940-12-07', 'official_source'),
    dataAtualizacaoLegal: editableField('2026-08-14', 'official_source'),
    dataFormatacaoVinculex: readOnlyField('2026-08-14', 'formatter'),
    totalArtigos: readOnlyField(1, 'ast_structure'),
    versaoVinculex: readOnlyField('1.0.0', 'publication'),
    legalStatus: editableField('vigente', 'editorial'),
    publicationStatus: readOnlyField('draft', 'publication'),
    tags: editableField([], 'editorial'),
    revogadaPor: editableField(null, 'editorial'),
    redacoesDadasPor: readOnlyField(0, 'ast_structure'),
    idsDepreciados: {
      ...readOnlyField(0, 'reconciliation'),
      blockedReason: 'derived_value',
    },
    fontesSecundarias: readOnlyField(0, 'source_catalog'),
    projectionProfile: {
      ...readOnlyField('complete_with_history', 'projection'),
      blockedReason: 'derived_value',
    },
    aliases: {
      ...readOnlyField([], 'reference_catalog'),
      blockedReason: 'derived_value',
    },
  },
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
  setPreviewProjectionProfile: {
    authorize: vi.fn(() => true),
    handle: vi.fn(
      (input: { projectId: string; projectionProfile: 'complete_with_history' | 'current_only' }) =>
        input,
    ),
  },
  getLegalReference: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      referenceId: REFERENCE_ID,
      targetTitle: 'Constituição Federal de 1988',
      targetSigla: 'cf88',
      targetLegalPath: 'Art. 37',
      targetDeviceStatus: 'active' as const,
      targetPlainText: 'A administração pública obedecerá aos princípios legais.',
      external: true,
    })),
  },
  navigateLegalReference: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      targetProjectId: PROJECT_ID,
      targetPreviewNodeId: SOURCE_ID,
      external: true,
    })),
  },
  getDiagnosticPage: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ items: [], nextCursor: null, totalItems: 0 })),
  },
  getEditorialState: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => editorialState),
  },
  correctEditorialText: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => editorialState),
  },
  confirmEditorialInterpretation: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => editorialState),
  },
  confirmEditorialWarning: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => editorialState),
  },
  validateEditorial: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => editorialState),
  },
  approveEditorial: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ ...editorialState, reviewApprovalStatus: 'approved' as const })),
  },
  getMetadataState: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => metadataState),
  },
  updateMetadata: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ ...metadataState, revisionHash: 'd'.repeat(64), journalSequence: 1 })),
  },
  chooseExportDestination: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ destinationId: DESTINATION_ID, displayName: 'Documentos' })),
  },
  writeExport: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      projectId: PROJECT_ID,
      revisionHash: 'c'.repeat(64),
      destinationId: DESTINATION_ID,
      fileName: 'codigo-penal.md',
      projectionProfile: 'complete_with_history' as const,
      byteLength: 2_048,
      markdownSha256: 'b'.repeat(64),
    })),
  },
  chooseBatchExportDestination: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ destinationId: DESTINATION_ID, displayName: 'Documentos' })),
  },
  writeBatchExport: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      destinationId: DESTINATION_ID,
      total: 1,
      succeeded: 1,
      failed: 0,
      results: [
        {
          projectId: PROJECT_ID,
          title: 'Código Penal',
          sigla: 'cp',
          batchExportStatus: 'succeeded' as const,
          revisionHash: 'c'.repeat(64),
          directoryName: 'codigo-penal',
          markdownFileName: 'cp.md',
          updateFileName: 'UPDATE.md' as const,
          markdownSha256: 'b'.repeat(64),
          updateSha256: 'd'.repeat(64),
        },
      ],
    })),
  },
  requestReprocessing: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      requestId: REQUEST_ID,
      projectId: PROJECT_ID,
      incidentId: null,
      jobId: JOB_ID,
      plan: 'from_source_snapshot' as const,
      reason: 'Nova versão do parser.',
      status: 'running' as const,
      resultingRevisionHash: null,
      conflictCode: null,
    })),
  },
  getReprocessingState: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => null),
  },
});

const updateCapabilities = (): DesktopUpdateIpcCapabilities => ({
  listUpdates: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ items: [], nextCursor: null })),
  },
  getUpdateDetail: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => {
      throw new Error('not used');
    }),
  },
  getUpdateCounts: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      pending: 1,
      approved: 0,
      rejected: 0,
      superseded: 0,
      error: 0,
      actionable: 1,
    })),
  },
  approveUpdate: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      updateId: UPDATE_ID,
      updateReviewStatus: 'approved' as const,
      publicationId: PROJECT_ID,
      retryCount: 0,
      reprocessRequested: false,
    })),
  },
  rejectUpdate: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      updateId: UPDATE_ID,
      updateReviewStatus: 'rejected' as const,
      publicationId: null,
      retryCount: 0,
      reprocessRequested: false,
    })),
  },
  reprocessUpdate: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      updateId: UPDATE_ID,
      updateReviewStatus: 'rejected' as const,
      publicationId: null,
      retryCount: 1,
      reprocessRequested: true,
    })),
  },
});

const sourceCatalogCapabilities = (): DesktopSourceCatalogIpcCapabilities => ({
  listCatalog: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({ items: [], nextCursor: null, adapterCapabilities: [] })),
  },
  createProviderRevision: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      providerId: SOURCE_ID,
      providerRevisionId: PROJECT_ID,
      revisionNumber: 1,
      providerLockVersion: 1,
    })),
  },
  createBindingRevision: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      bindingId: JOB_ID,
      bindingRevisionId: DESTINATION_ID,
      revisionNumber: 1,
      bindingLockVersion: 1,
    })),
  },
  dryRunBinding: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      testEvidenceId: TEST_EVIDENCE_ID,
      providerRevisionId: PROJECT_ID,
      bindingRevisionId: DESTINATION_ID,
      sourceTestOutcome: 'success' as const,
      completedStage: 'adapter' as const,
      evidenceDigest: 'd'.repeat(64),
      errorCode: null,
      testedAt: '2026-08-13T15:00:00.000Z',
    })),
  },
  activateBinding: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      providerId: SOURCE_ID,
      providerRevisionId: PROJECT_ID,
      providerLockVersion: 2,
      bindingId: JOB_ID,
      bindingRevisionId: DESTINATION_ID,
      bindingLockVersion: 2,
      sourceActivationState: 'active' as const,
    })),
  },
  pauseBinding: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      bindingId: JOB_ID,
      bindingRevisionId: DESTINATION_ID,
      bindingLockVersion: 3,
      sourceActivationState: 'paused' as const,
    })),
  },
  archiveBinding: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      bindingId: JOB_ID,
      bindingRevisionId: DESTINATION_ID,
      bindingLockVersion: 4,
      sourceActivationState: 'archived' as const,
    })),
  },
  restoreBinding: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      providerId: SOURCE_ID,
      providerRevisionId: PROJECT_ID,
      providerLockVersion: 3,
      bindingId: JOB_ID,
      bindingRevisionId: DESTINATION_ID,
      bindingLockVersion: 5,
      sourceActivationState: 'active' as const,
    })),
  },
  requestSourceCheck: {
    authorize: vi.fn(() => true),
    handle: vi.fn(() => ({
      sourceCheckJobId: UPDATE_ID,
      bindingId: JOB_ID,
      bindingRevisionId: DESTINATION_ID,
      sourceCheckJobState: 'queued' as const,
      requestedAt: '2026-08-13T15:00:00.000Z',
      deduplicated: false,
    })),
  },
});

type InvokeHandler = (
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  payload: unknown,
) => Promise<unknown>;

const setup = (
  importCapabilities = capabilities(),
  updateIpcCapabilities?: DesktopUpdateIpcCapabilities,
  sourceIpcCapabilities?: DesktopSourceCatalogIpcCapabilities,
) => {
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
    ...(updateIpcCapabilities === undefined ? {} : { updateCapabilities: updateIpcCapabilities }),
    ...(sourceIpcCapabilities === undefined
      ? {}
      : { sourceCatalogCapabilities: sourceIpcCapabilities }),
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
    const sourceCapabilities = sourceCatalogCapabilities();
    const { dispose, event, handlers } = setup(capabilities(), undefined, sourceCapabilities);
    const expectedChannels = [
      APP_GET_VERSION_CHANNEL,
      SOURCE_SELECT_LOCAL_CHANNEL,
      SOURCE_IMPORT_URL_CHANNEL,
      PIPELINE_START_CHANNEL,
      PIPELINE_CANCEL_CHANNEL,
      PREVIEW_GET_DOCUMENT_CHANNEL,
      PREVIEW_GET_PAGE_CHANNEL,
      PREVIEW_REVEAL_NODE_CHANNEL,
      PREVIEW_SET_PROJECTION_PROFILE_CHANNEL,
      PREVIEW_GET_LEGAL_REFERENCE_CHANNEL,
      PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL,
      DIAGNOSTICS_GET_PAGE_CHANNEL,
      EDITORIAL_GET_STATE_CHANNEL,
      EDITORIAL_CORRECT_TEXT_CHANNEL,
      EDITORIAL_CONFIRM_INTERPRETATION_CHANNEL,
      EDITORIAL_CONFIRM_WARNING_CHANNEL,
      EDITORIAL_VALIDATE_CHANNEL,
      EDITORIAL_APPROVE_CHANNEL,
      METADATA_GET_STATE_CHANNEL,
      METADATA_UPDATE_CHANNEL,
      EXPORT_CHOOSE_DESTINATION_CHANNEL,
      EXPORT_WRITE_CHANNEL,
      EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL,
      EXPORT_WRITE_BATCH_CHANNEL,
      REPROCESSING_REQUEST_CHANNEL,
      REPROCESSING_GET_STATE_CHANNEL,
      PUBLICATION_PREPARE_CHANNEL,
      PUBLICATION_EXECUTE_CHANNEL,
      PUBLICATION_GET_ATTEMPT_CHANNEL,
      PUBLICATION_RETRY_CHANNEL,
      PUBLICATION_LIST_HISTORY_CHANNEL,
      PUBLICATION_GET_DIFF_CHANNEL,
      PUBLICATION_PREPARE_ROLLBACK_CHANNEL,
      UPDATES_LIST_CHANNEL,
      UPDATES_GET_DETAIL_CHANNEL,
      UPDATES_GET_COUNTS_CHANNEL,
      UPDATES_APPROVE_CHANNEL,
      UPDATES_REJECT_CHANNEL,
      UPDATES_REPROCESS_CHANNEL,
      SOURCES_LIST_CHANNEL,
      SOURCES_CREATE_PROVIDER_REVISION_CHANNEL,
      SOURCES_CREATE_BINDING_REVISION_CHANNEL,
      SOURCES_DRY_RUN_CHANNEL,
      SOURCES_ACTIVATE_CHANNEL,
      SOURCES_PAUSE_CHANNEL,
      SOURCES_ARCHIVE_CHANNEL,
      SOURCES_RESTORE_CHANNEL,
      SOURCES_REQUEST_CHECK_CHANNEL,
      AUDIT_QUERY_CHANNEL,
      AUDIT_GET_DETAIL_CHANNEL,
      AUDIT_GET_TIMELINE_CHANNEL,
      AUDIT_GET_INCIDENT_CHANNEL,
      AUDIT_RECORD_INCIDENT_NOTE_CHANNEL,
      AUDIT_OPEN_EVIDENCE_CHANNEL,
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
      handlers.get(PREVIEW_SET_PROJECTION_PROFILE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        projectionProfile: 'current_only',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { projectId: PROJECT_ID, projectionProfile: 'current_only' },
    });
    await expect(
      handlers.get(PREVIEW_GET_LEGAL_REFERENCE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        referenceId: REFERENCE_ID,
      }),
    ).resolves.toMatchObject({ ok: true, value: { targetSigla: 'cf88' } });
    await expect(
      handlers.get(PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        referenceId: REFERENCE_ID,
      }),
    ).resolves.toMatchObject({ ok: true, value: { targetProjectId: PROJECT_ID } });
    await expect(
      handlers.get(EDITORIAL_GET_STATE_CHANNEL)?.(event, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: true, value: { canApprove: true } });
    await expect(
      handlers.get(METADATA_GET_STATE_CHANNEL)?.(event, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: true, value: { revisionHash: 'c'.repeat(64) } });
    await expect(
      handlers.get(EXPORT_CHOOSE_DESTINATION_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        projectionProfile: 'complete_with_history',
      }),
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
    await expect(
      handlers.get(EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL)?.(event, {
        projectIds: [PROJECT_ID],
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.get(EXPORT_WRITE_BATCH_CHANNEL)?.(event, { destinationId: DESTINATION_ID }),
    ).resolves.toMatchObject({ ok: true, value: { succeeded: 1 } });
    await expect(
      handlers.get(REPROCESSING_REQUEST_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        requestId: REQUEST_ID,
        plan: 'from_source_snapshot',
        expectedRevisionHash: 'c'.repeat(64),
        reason: 'Nova versão do parser.',
        incidentId: null,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: 'running' } });
    await expect(
      handlers.get(REPROCESSING_GET_STATE_CHANNEL)?.(event, { projectId: PROJECT_ID }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      handlers.get(SOURCES_LIST_CHANNEL)?.(event, { cursor: null, limit: 25 }),
    ).resolves.toEqual({
      ok: true,
      value: { items: [], nextCursor: null, adapterCapabilities: [] },
    });
    await expect(
      handlers.get(SOURCES_REQUEST_CHECK_CHANNEL)?.(event, {
        bindingId: JOB_ID,
        idempotencyKey: 'manual-check-1',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { bindingId: JOB_ID, sourceCheckJobState: 'queued' },
    });

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
      writeBatchExport: {
        ...defaults.writeBatchExport,
        authorize: vi.fn(() => false),
      },
      navigateLegalReference: {
        ...defaults.navigateLegalReference,
        authorize: vi.fn(() => false),
      },
      requestReprocessing: {
        ...defaults.requestReprocessing,
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
      handlers.get(PREVIEW_GET_LEGAL_REFERENCE_CHANNEL)?.(forgedEvent, {
        projectId: PROJECT_ID,
        referenceId: REFERENCE_ID,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    await expect(
      handlers.get(PREVIEW_GET_LEGAL_REFERENCE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        referenceId: REFERENCE_ID,
        markdownPath: '/tmp/cf88.md',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(
      handlers.get(PREVIEW_NAVIGATE_LEGAL_REFERENCE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        referenceId: REFERENCE_ID,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    await expect(
      handlers.get(PIPELINE_START_CHANNEL)?.(event, {
        sourceId: SOURCE_ID,
        path: '/etc/passwd',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(
      handlers.get(REPROCESSING_REQUEST_CHANNEL)?.(forgedEvent, {
        projectId: PROJECT_ID,
        requestId: REQUEST_ID,
        plan: 'from_source_snapshot',
        expectedRevisionHash: 'c'.repeat(64),
        reason: 'Tentativa forjada.',
        incidentId: null,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    await expect(
      handlers.get(REPROCESSING_REQUEST_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        requestId: REQUEST_ID,
        plan: 'from_source_snapshot',
        expectedRevisionHash: 'c'.repeat(64),
        reason: 'Tentativa direta.',
        incidentId: null,
        jobId: JOB_ID,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(
      handlers.get(EDITORIAL_CORRECT_TEXT_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        previewNodeId: SOURCE_ID,
        value: 'Texto corrigido.',
        reason: 'Conferido na fonte oficial.',
        domainNodeId: 'no-art-1',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(
      handlers.get(METADATA_GET_STATE_CHANNEL)?.(forgedEvent, { projectId: PROJECT_ID }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    await expect(
      handlers.get(METADATA_UPDATE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        expectedRevisionHash: 'c'.repeat(64),
        changes: { fonte: 'https://example.com/forjada' },
        reason: 'Tentativa direta.',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(
      handlers.get(METADATA_UPDATE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        expectedRevisionHash: 'c'.repeat(64),
        changes: { titulo: 'x'.repeat(40_000) },
        reason: 'Payload excessivo.',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
    await expect(
      handlers.get(EXPORT_WRITE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        destinationId: DESTINATION_ID,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    await expect(
      handlers.get(EXPORT_CHOOSE_BATCH_DESTINATION_CHANNEL)?.(event, {
        projectIds: [PROJECT_ID, PROJECT_ID],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(
      handlers.get(EXPORT_WRITE_BATCH_CHANNEL)?.(event, { destinationId: DESTINATION_ID }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });

    expect(importCapabilities.selectLocal.handle).not.toHaveBeenCalled();
    expect(importCapabilities.importFromUrl.handle).not.toHaveBeenCalled();
    expect(importCapabilities.startProcessing.handle).not.toHaveBeenCalled();
    expect(importCapabilities.correctEditorialText.handle).not.toHaveBeenCalled();
    expect(importCapabilities.updateMetadata.handle).not.toHaveBeenCalled();
    expect(importCapabilities.writeExport.handle).not.toHaveBeenCalled();
    expect(importCapabilities.writeBatchExport.handle).not.toHaveBeenCalled();
    expect(importCapabilities.getLegalReference.handle).not.toHaveBeenCalled();
    expect(importCapabilities.navigateLegalReference.handle).not.toHaveBeenCalled();
    expect(event.sender.mainFrame).toBe(frame);
  });

  it('valida capacidades de atualização e não aceita identidade ou caminho vindos do renderer', async () => {
    const updates = updateCapabilities();
    const { event, handlers } = setup(capabilities(), updates);
    await expect(handlers.get(UPDATES_GET_COUNTS_CHANNEL)?.(event, {})).resolves.toMatchObject({
      ok: true,
      value: { actionable: 1 },
    });
    await expect(
      handlers.get(UPDATES_REJECT_CHANNEL)?.(event, {
        updateId: UPDATE_ID,
        reason: 'A fonte oficial apresentou divergência real.',
        actorUserId: PROJECT_ID,
        candidatePath: '/tmp/candidate.json',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(updates.rejectUpdate.handle).not.toHaveBeenCalled();
  });

  it('preserva conflito de revisão e recusa resposta de metadados excessiva', async () => {
    const defaults = capabilities();
    const conflicted: DesktopImportIpcCapabilities = {
      ...defaults,
      updateMetadata: {
        authorize: vi.fn(() => true),
        handle: vi.fn(() => {
          throw new DesktopIpcError('CONFLICT');
        }),
      },
    };
    const { event, handlers } = setup(conflicted);
    await expect(
      handlers.get(METADATA_UPDATE_CHANNEL)?.(event, {
        projectId: PROJECT_ID,
        expectedRevisionHash: 'c'.repeat(64),
        changes: { titulo: 'Código Penal revisado' },
        reason: 'Conferido na fonte oficial.',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    const leaking: DesktopImportIpcCapabilities = {
      ...defaults,
      getMetadataState: {
        authorize: vi.fn(() => true),
        handle: vi.fn(
          () =>
            ({
              ...metadataState,
              ast: { astPhase: 'identified' },
              repositoryPath: '/tmp/segredo',
            }) as unknown as MetadataStateDto,
        ),
      },
    };
    const leakedSetup = setup(leaking);
    const leaked = await leakedSetup.handlers.get(METADATA_GET_STATE_CHANNEL)?.(leakedSetup.event, {
      projectId: PROJECT_ID,
    });
    expect(leaked).toMatchObject({ ok: false, error: { code: 'FAILED' } });
    expect(JSON.stringify(leaked)).not.toMatch(/astPhase|repositoryPath|segredo/iu);
  });

  it('valida intenção administrativa sem aceitar ator, papel, token ou resposta privilegiada', async () => {
    const sources = sourceCatalogCapabilities();
    const { event, handlers } = setup(capabilities(), undefined, sources);
    const forgedFrame = {
      isDestroyed: () => false,
      url: 'file:///tmp/forged-source-catalog.html',
    } as WebFrameMain;
    await expect(
      handlers.get(SOURCES_LIST_CHANNEL)?.(
        { ...event, senderFrame: forgedFrame },
        { cursor: null, limit: 25 },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    await expect(
      handlers.get(SOURCES_LIST_CHANNEL)?.(event, {
        cursor: null,
        limit: 25,
        actorUserId: SOURCE_ID,
        role: 'administrador',
        accessToken: 'secret',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(sources.listCatalog.handle).not.toHaveBeenCalled();

    const leakingSources: DesktopSourceCatalogIpcCapabilities = {
      ...sourceCatalogCapabilities(),
      listCatalog: {
        authorize: vi.fn(() => true),
        handle: vi.fn(
          () =>
            ({
              items: [],
              nextCursor: null,
              html: '<script>secret()</script>',
            }) as unknown as Awaited<
              ReturnType<DesktopSourceCatalogIpcCapabilities['listCatalog']['handle']>
            >,
        ),
      },
    };
    const { handlers: leakingHandlers, event: leakingEvent } = setup(
      capabilities(),
      undefined,
      leakingSources,
    );
    const leaked = await leakingHandlers.get(SOURCES_LIST_CHANNEL)?.(leakingEvent, {
      cursor: null,
      limit: 25,
    });
    expect(leaked).toMatchObject({ ok: false, error: { code: 'FAILED' } });
    expect(JSON.stringify(leaked)).not.toMatch(/script|secret|html/iu);
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
