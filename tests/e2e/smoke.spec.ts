import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lança o diretório do aplicativo, não o arquivo de entrada: assim o Electron
// lê o package.json e resolve `main`, nome e versão como faria no pacote.
// Apontar direto para o bundle faria `app.getVersion()` cair no fallback da
// versão do próprio Electron.
const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const e2eOutputDirectory = join(appDirectory, 'output/playwright/source-catalog');
const sourceCatalogHarnessPath = join(e2eOutputDirectory, 'source-catalog-harness.mjs');

const inheritedEnvironment = (): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    // Sem ELECTRON_RENDERER_URL o main resolve a interface pelo arquivo local,
    // exatamente como no pacote de produção.
    if (key === 'ELECTRON_RENDERER_URL') {
      continue;
    }

    // Terminais embarcados em aplicativos Electron (VS Code, Claude Code)
    // exportam ELECTRON_RUN_AS_NODE=1. Herdar essa variável faria o binário
    // subir como Node puro, rejeitar as flags do Chromium e nunca abrir janela.
    if (key === 'ELECTRON_RUN_AS_NODE') {
      continue;
    }

    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
};

let app: ElectronApplication;
let mainWindow: Page;

test.beforeAll(async () => {
  await mkdir(e2eOutputDirectory, { recursive: true });
  await build({
    entryPoints: [join(appDirectory, 'tests/e2e/support/source-catalog-harness.ts')],
    outfile: sourceCatalogHarnessPath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'external',
  });
  app = await electron.launch({
    args: [appDirectory],
    env: {
      ...inheritedEnvironment(),
      LEX_EDITOR_E2E_SOURCE_CATALOG: '1',
      LEX_EDITOR_E2E_SOURCE_CATALOG_MODULE: sourceCatalogHarnessPath,
    },
  });
  mainWindow = await app.firstWindow();
  await mainWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  await rm(e2eOutputDirectory, { recursive: true, force: true });
});

test('abre a janela principal com as três áreas do shell', async () => {
  await expect(mainWindow).toHaveTitle('Lex Editor');

  await expect(mainWindow.getByRole('heading', { name: 'Importação' })).toBeVisible();
  await expect(mainWindow.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(mainWindow.getByRole('heading', { name: 'Publicação' })).toBeVisible();
  await expect(mainWindow.getByRole('heading', { name: 'Logs e validação' })).toBeVisible();
});

test('aplica as preferências seguras na janela real', async () => {
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();

    if (!window) {
      return null;
    }

    // `getLastWebPreferences` devolve as preferências efetivamente aplicadas.
    // Ela existe em runtime no Electron 43, mas não consta de electron.d.ts;
    // o cast é o mínimo necessário para ler o valor real em vez de reafirmar a
    // configuração de origem, que o teste unitário já cobre.
    const contents = window.webContents as unknown as {
      getLastWebPreferences?: () => Record<string, unknown> | null;
    };

    return contents.getLastWebPreferences?.() ?? null;
  });

  expect(preferences).not.toBeNull();
  expect(preferences).toMatchObject({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
  });
});

test('serve o bundle sob a CSP restritiva da ADR-007', async () => {
  const policy = await mainWindow
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');

  expect(policy).not.toBeNull();

  // O desenvolvimento relaxa style-src e connect-src para viabilizar o HMR.
  // Nenhuma das duas concessões pode alcançar o pacote.
  expect(policy).not.toContain('unsafe-inline');
  expect(policy).not.toContain('unsafe-eval');
  expect(policy).toContain("connect-src 'none'");

  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ]) {
    expect(policy).toContain(directive);
  }
});

test('não entrega Node, Electron ou ipcRenderer ao renderer', async () => {
  const reachable = await mainWindow.evaluate(() => {
    const globalScope = globalThis as unknown as Record<string, unknown>;

    return {
      require: typeof globalScope['require'],
      process: typeof globalScope['process'],
      module: typeof globalScope['module'],
      ipcRenderer: typeof globalScope['ipcRenderer'],
      electron: typeof globalScope['electron'],
      // A ponte não pode vazar o objeto bruto por baixo da API nomeada.
      bridgeKeys: Object.keys(globalScope['lexDesktop'] ?? {}).sort(),
    };
  });

  expect(reachable.require).toBe('undefined');
  expect(reachable.process).toBe('undefined');
  expect(reachable.module).toBe('undefined');
  expect(reachable.ipcRenderer).toBe('undefined');
  expect(reachable.electron).toBe('undefined');
  expect(reachable.bridgeKeys).toEqual([
    'app',
    'capabilities',
    'diagnostics',
    'editorial',
    'export',
    'pipeline',
    'preview',
    'publication',
    'source',
    'sources',
    'updates',
    'version',
  ]);
});

test('expõe somente a capacidade declarada e ela responde', async () => {
  const bridge = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as Record<string, unknown>)['lexDesktop'] as
      | {
          version: number;
          capabilities: readonly string[];
          app: { getVersion(): Promise<unknown> };
          source: { selectLocal(): Promise<unknown> };
          pipeline: Record<string, unknown>;
          preview: Record<string, unknown>;
          diagnostics: Record<string, unknown>;
          editorial: Record<string, unknown>;
          publication: Record<string, unknown>;
          updates: Record<string, unknown>;
          sources: Record<string, unknown>;
          export: {
            chooseDestination(input: {
              projectId: string;
              projectionProfile: 'complete_with_history' | 'current_only';
            }): Promise<unknown>;
            write(input: { projectId: string; destinationId: string }): Promise<unknown>;
            chooseBatchDestination(input: { projectIds: string[] }): Promise<unknown>;
            writeBatch(input: { destinationId: string }): Promise<unknown>;
          };
        }
      | undefined;

    if (!api) {
      return null;
    }

    return {
      version: api.version,
      capabilities: [...api.capabilities],
      appKeys: Object.keys(api.app).sort(),
      sourceKeys: Object.keys(api.source).sort(),
      pipelineKeys: Object.keys(api.pipeline).sort(),
      previewKeys: Object.keys(api.preview).sort(),
      diagnosticKeys: Object.keys(api.diagnostics).sort(),
      editorialKeys: Object.keys(api.editorial).sort(),
      publicationKeys: Object.keys(api.publication).sort(),
      updatesKeys: Object.keys(api.updates).sort(),
      sourcesKeys: Object.keys(api.sources).sort(),
      exportKeys: Object.keys(api.export).sort(),
      result: await api.app.getVersion(),
    };
  });

  expect(bridge).not.toBeNull();
  expect(bridge?.version).toBe(1);
  expect(bridge?.capabilities).toEqual([
    'app.getVersion',
    'source.selectLocal',
    'source.importFromUrl',
    'pipeline.start',
    'pipeline.cancel',
    'pipeline.onProgress',
    'preview.getDocument',
    'preview.getPage',
    'preview.revealNode',
    'preview.setProjectionProfile',
    'preview.getLegalReference',
    'preview.navigateLegalReference',
    'diagnostics.getPage',
    'editorial.getState',
    'editorial.correctText',
    'editorial.confirmInterpretation',
    'editorial.confirmWarning',
    'editorial.validate',
    'editorial.approve',
    'export.chooseDestination',
    'export.write',
    'export.chooseBatchDestination',
    'export.writeBatch',
    'publication.prepare',
    'publication.execute',
    'publication.getAttempt',
    'publication.retry',
    'publication.listHistory',
    'publication.getDiff',
    'publication.prepareRollback',
    'updates.list',
    'updates.getDetail',
    'updates.getCounts',
    'updates.approve',
    'updates.reject',
    'updates.reprocess',
    'sources.list',
    'sources.createProviderRevision',
    'sources.createBindingRevision',
    'sources.dryRun',
    'sources.activate',
    'sources.pause',
    'sources.archive',
    'sources.restore',
    'sources.requestCheck',
  ]);
  expect(bridge?.appKeys).toEqual(['getVersion']);
  expect(bridge?.sourceKeys).toEqual(['importFromUrl', 'selectLocal']);
  expect(bridge?.pipelineKeys).toEqual(['cancel', 'onProgress', 'start']);
  expect(bridge?.previewKeys).toEqual([
    'getDocument',
    'getLegalReference',
    'getPage',
    'navigateLegalReference',
    'revealNode',
    'setProjectionProfile',
  ]);
  expect(bridge?.diagnosticKeys).toEqual(['getPage']);
  expect(bridge?.editorialKeys).toEqual([
    'approve',
    'confirmInterpretation',
    'confirmWarning',
    'correctText',
    'getState',
    'validate',
  ]);
  expect(bridge?.publicationKeys).toEqual([
    'execute',
    'getAttempt',
    'getDiff',
    'listHistory',
    'prepare',
    'prepareRollback',
    'retry',
  ]);
  expect(bridge?.updatesKeys).toEqual([
    'approve',
    'getCounts',
    'getDetail',
    'list',
    'reject',
    'reprocess',
  ]);
  expect(bridge?.sourcesKeys).toEqual([
    'activate',
    'archive',
    'createBindingRevision',
    'createProviderRevision',
    'dryRun',
    'list',
    'pause',
    'requestCheck',
    'restore',
  ]);
  expect(bridge?.exportKeys).toEqual([
    'chooseBatchDestination',
    'chooseDestination',
    'write',
    'writeBatch',
  ]);
  expect(bridge?.result).toEqual({ ok: true, value: { version: '0.1.0' } });
});

test('não vaza caminho real, segredo ou AST pela ponte', async () => {
  const payload = await mainWindow.evaluate(async () => {
    const api = (globalThis as unknown as Record<string, unknown>)['lexDesktop'] as {
      app: { getVersion(): Promise<unknown> };
    };

    return JSON.stringify(await api.app.getVersion());
  });

  // O DTO da única capacidade existente carrega apenas a versão. Qualquer
  // caminho de filesystem, token ou árvore normativa aqui seria violação da
  // ADR-007; este teste falha assim que um DTO futuro passar a vazá-los.
  expect(payload).not.toMatch(/\/home\/|[A-Za-z]:\\|\.\.\//);
  expect(payload).not.toMatch(/secret|token|password|senha|apikey|api_key/i);
  expect(payload).not.toMatch(/normaAst|blockId|sourceRef/i);
});

test('cadastra, testa e ativa uma nova origem pela UI e a usa na importação', async () => {
  const sourceUrl = 'https://planalto.gov.br/ccivil_03/leis/l9099.htm';
  await mainWindow.getByRole('link', { name: /Configuração de fontes/u }).click();
  const newSource = mainWindow.getByRole('button', { name: 'Nova fonte oficial' });
  await expect(newSource).toBeEnabled();
  await newSource.click();

  const providerKey = mainWindow.getByLabel('Chave do provedor');
  await expect(providerKey).toBeFocused();
  await providerKey.fill('planalto-e2e');
  await mainWindow.getByLabel('Nome do provedor').fill('Origem Planalto sem www');
  await mainWindow.getByLabel('UUID da lei').fill('99999999-9999-4999-8999-999999999999');
  await mainWindow.getByLabel('Host oficial').selectOption('planalto.gov.br');
  await mainWindow.getByLabel('Prefixo de caminho').fill('/ccivil_03/leis/');
  await mainWindow.locator('select[name="primary-variant"]').selectOption('annotated');
  await mainWindow.getByLabel('URL oficial').fill(sourceUrl);
  await mainWindow.getByRole('button', { name: 'Criar revisão e testar' }).click();

  const confirmation = mainWindow.getByRole('dialog', { name: 'Confirmar alteração da fonte?' });
  await expect(confirmation).toBeVisible({ timeout: 30_000 });
  await confirmation.getByRole('button', { name: 'Confirmar alteração' }).click();
  await expect(mainWindow.getByText('Revisão testada ativada.')).toBeVisible();
  await expect(mainWindow.getByText('Lei nº 9.099/1995 — origem E2E')).toBeVisible();
  await expect(mainWindow.getByText('Ativa', { exact: true })).toBeVisible();

  const pause = mainWindow.getByRole('button', { name: 'Pausar' });
  await pause.focus();
  await mainWindow.keyboard.press('Enter');
  const pauseConfirmation = mainWindow.getByRole('dialog', {
    name: 'Confirmar alteração da fonte?',
  });
  await expect(pauseConfirmation.getByRole('button', { name: 'Voltar' })).toBeFocused();
  await mainWindow.keyboard.press('Tab');
  await mainWindow.keyboard.press('Enter');
  await expect(mainWindow.getByText('Fonte pausada; novos jobs foram bloqueados.')).toBeVisible();

  const restore = mainWindow.getByRole('button', { name: 'Restaurar revisão' });
  await restore.focus();
  await mainWindow.keyboard.press('Enter');
  const restoreConfirmation = mainWindow.getByRole('dialog', {
    name: 'Confirmar alteração da fonte?',
  });
  await expect(restoreConfirmation.getByRole('button', { name: 'Voltar' })).toBeFocused();
  await mainWindow.keyboard.press('Tab');
  await mainWindow.keyboard.press('Enter');
  await expect(mainWindow.getByText('Revisão testada restaurada.')).toBeVisible();

  await mainWindow.getByRole('link', { name: 'Importação Nova fonte' }).click();
  await mainWindow.getByLabel('URL da fonte oficial').fill(sourceUrl);
  await mainWindow.getByRole('button', { name: 'Importar URL' }).click();

  await expect(
    mainWindow.locator('.import-panel').getByText('l9099.htm', { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(mainWindow.locator('.preview-document')).toBeVisible({ timeout: 30_000 });
  await expect(mainWindow.locator('.document-state')).toContainText('l9099');
});

test('nega abertura de nova janela a partir do renderer', async () => {
  const opened = await mainWindow.evaluate(() => {
    // O escopo do `evaluate` é o do navegador; a tipagem do projeto é Node, por
    // isso `open` precisa ser declarada aqui.
    const browserScope = globalThis as unknown as { open(url: string): unknown };

    return browserScope.open('https://exemplo.invalido') !== null;
  });

  expect(opened).toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('mantém uma allowlist de canais IPC sem executor genérico', async () => {
  const registered = await app.evaluate(({ ipcMain }) => {
    const candidates = [
      'app:get-version',
      'source:select-local',
      'source:import-url',
      'pipeline:start',
      'pipeline:cancel',
      'preview:get-document',
      'preview:get-page',
      'preview:reveal-node',
      'diagnostics:get-page',
      'editorial:get-state',
      'editorial:correct-text',
      'editorial:confirm-interpretation',
      'editorial:confirm-warning',
      'editorial:validate',
      'editorial:approve',
      'export:choose-destination',
      'export:write',
      'export:choose-batch-destination',
      'export:write-batch',
      'updates:list',
      'updates:get-detail',
      'updates:get-counts',
      'updates:approve',
      'updates:reject',
      'updates:reprocess',
      'sources:list',
      'sources:create-provider-revision',
      'sources:create-binding-revision',
      'sources:dry-run',
      'sources:activate',
      'sources:pause',
      'sources:archive',
      'sources:restore',
      'sources:request-check',
      'execute',
      'shell',
      'readFile',
      'writeFile',
      'git',
      'supabase',
    ];

    // `ipcMain.handle` não aparece em `listenerCount`, que só conta listeners de
    // evento. Registrar duas vezes o mesmo canal lança — é essa recusa que prova
    // a existência do handler. Onde o registro passa, o canal estava livre e o
    // handler de sondagem é removido em seguida.
    return candidates.filter((channel) => {
      try {
        ipcMain.handle(channel, () => null);
        ipcMain.removeHandler(channel);
        return false;
      } catch {
        return true;
      }
    });
  });

  expect(registered).toEqual([
    'app:get-version',
    'source:select-local',
    'source:import-url',
    'pipeline:start',
    'pipeline:cancel',
    'preview:get-document',
    'preview:get-page',
    'preview:reveal-node',
    'diagnostics:get-page',
    'editorial:get-state',
    'editorial:correct-text',
    'editorial:confirm-interpretation',
    'editorial:confirm-warning',
    'editorial:validate',
    'editorial:approve',
    'export:choose-destination',
    'export:write',
    'export:choose-batch-destination',
    'export:write-batch',
    'updates:list',
    'updates:get-detail',
    'updates:get-counts',
    'updates:approve',
    'updates:reject',
    'updates:reprocess',
    'sources:list',
    'sources:create-provider-revision',
    'sources:create-binding-revision',
    'sources:dry-run',
    'sources:activate',
    'sources:pause',
    'sources:archive',
    'sources:restore',
    'sources:request-check',
  ]);
});
