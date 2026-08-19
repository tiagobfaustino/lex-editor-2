import { BrowserWindow, Menu, app, dialog, session } from 'electron';

import {
  DESKTOP_IMPORT_LIMITS,
  PIPELINE_PROGRESS_CHANNEL,
  ProgressDtoSchema,
} from '../shared/ipc/import.js';
import { registerIpcHandlers } from './ipc/register.js';
import { createLocalProjectService } from './local-project-service.js';
import { resolveRendererLocation } from './renderer-location.js';
import { denyAllSessionPermissions, installWebContentsGuards } from './security.js';
import { loadSourceCatalogE2eHarness } from './source-catalog-e2e-harness.js';
import { createDesktopSourceCatalogIpcCapabilities } from './source-catalog-ipc-capabilities.js';
import { createDesktopAuditIpcCapabilities } from './audit/audit-ipc-capabilities.js';
import { createEvidenceProvider } from './audit/evidence-provider.js';
import { createFederatedAuditService } from './audit/federated-audit-service.js';
import { createIncidentActions } from './audit/incident-actions.js';
import { createLocalAuditJournalStore } from './audit/local-audit-journal.js';
import { createLocalAuditProvider } from './audit/local-audit-provider.js';
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

void app.whenReady().then(async () => {
  const developmentUrl = process.env['ELECTRON_RENDERER_URL'];
  const rendererLocation = resolveRendererLocation({
    productionUrl: new URL('../renderer/index.html', import.meta.url).href,
    ...(developmentUrl === undefined ? {} : { developmentUrl }),
  });

  denyAllSessionPermissions(session.defaultSession);

  Menu.setApplicationMenu(null);
  const storageRoot = app.getPath('userData');
  const auditJournal = createLocalAuditJournalStore(storageRoot);
  const sourceCatalogHarness = await loadSourceCatalogE2eHarness({
    isPackaged: app.isPackaged,
    storageRoot,
    environment: process.env,
  });
  const importCapabilities = createLocalProjectService({
    storageRoot,
    dialog,
    getMainWindow: () => mainWindow,
    sendProgress: (progress) => {
      const parsed = ProgressDtoSchema.safeParse(progress);
      const encoded = parsed.success ? Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') : 0;

      if (
        parsed.success &&
        encoded <= DESKTOP_IMPORT_LIMITS.progressEventBytes &&
        mainWindow !== null &&
        !mainWindow.isDestroyed()
      ) {
        mainWindow.webContents.send(PIPELINE_PROGRESS_CHANNEL, parsed.data);
      }
    },
    auditJournalStore: auditJournal,
    ...(sourceCatalogHarness === null
      ? {}
      : {
          activeSourceImportResolver: sourceCatalogHarness.activeSourceImportResolver,
          networkPorts: sourceCatalogHarness.networkPorts,
        }),
  });
  const federatedAuditService = createFederatedAuditService({
    providers: [
      createLocalAuditProvider(auditJournal),
      ...(sourceCatalogHarness?.auditProviders ?? []),
    ],
  });
  const evidenceProvider = createEvidenceProvider(auditJournal, storageRoot);
  const incidentActions = createIncidentActions({
    journal: auditJournal,
    evidenceProvider,
    service: federatedAuditService,
  });
  disposeIpcHandlers = registerIpcHandlers({
    rendererLocation,
    getMainWindow: () => mainWindow,
    importCapabilities,
    auditCapabilities: createDesktopAuditIpcCapabilities({
      service: federatedAuditService,
      // A identidade vem da sessão privilegiada do processo principal; o
      // renderer nunca escolhe ator ou papel. Provedores remotos continuam
      // indisponíveis até existir uma sessão administrativa autenticada.
      getActor: () => ({
        actorKey: 'local-technical-administrator',
        actorRole: 'administrador_tecnico',
      }),
      recordIncidentNote: incidentActions.recordIncidentNote,
      openEvidence: incidentActions.openEvidence,
    }),
    ...(sourceCatalogHarness === null
      ? {}
      : {
          sourceCatalogCapabilities: createDesktopSourceCatalogIpcCapabilities({
            service: sourceCatalogHarness.service,
            getAccessToken: sourceCatalogHarness.getAccessToken,
          }),
        }),
  });
  openMainWindow(rendererLocation);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow(rendererLocation);
    }
  });
});
