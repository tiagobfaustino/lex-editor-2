import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MetadataStateDto } from '../../src/shared/ipc/metadata.js';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (...parts: string[]): string => join(appDirectory, 'fixtures', 'legal', ...parts);

const inheritedEnvironment = (): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ELECTRON_RENDERER_URL' && key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)
      result[key] = value;
  }
  return result;
};

let app: ElectronApplication;
let mainWindow: Page;
let temporaryRoot: string;
let exportPath: string;

const withIdentityState = (
  state: MetadataStateDto,
  publicationHistoryState: 'published' | 'never_published',
): MetadataStateDto => {
  const next = structuredClone(state);
  next.publicationHistoryState = publicationHistoryState;
  for (const field of ['sigla', 'tipoNorma', 'numero', 'ano'] as const) {
    next.fields[field].editable = publicationHistoryState === 'never_published';
    next.fields[field].blockedReason =
      publicationHistoryState === 'published' ? 'published_identity' : null;
  }
  return next;
};

const replaceMetadataStateHandler = async (
  electronApp: ElectronApplication,
  state: MetadataStateDto,
): Promise<void> => {
  await electronApp.evaluate(({ ipcMain }, value) => {
    ipcMain.removeHandler('metadata:get-state');
    ipcMain.handle('metadata:get-state', () => ({ ok: true, value }));
  }, state);
};

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'lex-feature-012-ui-'));
  const sourcePath = join(temporaryRoot, 'lindb-metadados.md');
  exportPath = join(temporaryRoot, 'lindb-metadados-exportados.md');
  await readFile(fixture('lindb', 'esperado.md')).then((bytes) => writeFile(sourcePath, bytes));
  app = await electron.launch({
    args: [appDirectory],
    env: {
      ...inheritedEnvironment(),
      XDG_CONFIG_HOME: join(temporaryRoot, 'config'),
    },
  });
  await app.evaluate(({ dialog }, path) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: () => Promise.resolve({ canceled: false, filePaths: [path] }),
    });
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: () =>
        Promise.resolve({ canceled: false, filePath: path.replace(/\.md$/u, '-exportados.md') }),
    });
  }, sourcePath);
  mainWindow = await app.firstWindow();
  await mainWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  await rm(temporaryRoot, { recursive: true, force: true });
});

test('edita, corrige, cancela, salva e recupera conflito somente por teclado', async () => {
  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.locator('.document-state')).toContainText('lindb · 30 artigos', {
    timeout: 30_000,
  });

  const panel = mainWindow.locator('#metadados');
  const editButton = panel.getByRole('button', { name: 'Editar metadados' });
  await editButton.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(panel.getByLabel('Título')).toBeFocused();

  const originalBranch = await panel.getByLabel('Ramo').inputValue();
  await panel.getByLabel('Ramo').fill('');
  const reviewButton = panel.getByRole('button', { name: 'Revisar alterações' });
  await reviewButton.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(panel.getByLabel('Ramo')).toBeFocused();
  await expect(panel.getByText('Ramo é obrigatório.')).toBeVisible();

  await panel.getByLabel('Ramo').fill('Direito administrativo');
  await panel.getByLabel('Motivo da alteração').fill('Conferência editorial da classificação.');
  await reviewButton.focus();
  await mainWindow.keyboard.press('Enter');
  const dialog = mainWindow.getByRole('dialog', {
    name: 'Confirmar alterações de metadados?',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Direito administrativo');
  await mainWindow.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(reviewButton).toBeFocused();

  const cancelButton = panel.getByRole('button', { name: 'Cancelar' });
  await cancelButton.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(editButton).toBeFocused();
  await editButton.press('Enter');
  await expect(panel.getByLabel('Ramo')).toHaveValue(originalBranch);

  await panel.getByLabel('Título').fill('Lei de Introdução revisada no E2E');
  await panel.getByLabel('Ramo').fill('Direito processual');
  await panel.getByLabel('Motivo da alteração').fill('Correção confirmada na fonte oficial.');
  await reviewButton.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Voltar à edição' })).toBeFocused();
  await mainWindow.keyboard.press('Tab');
  await mainWindow.keyboard.press('Enter');
  await expect(editButton).toBeFocused();
  await expect(panel.getByRole('status')).toContainText('Metadados salvos no diário local');
  await expect(panel).toContainText('Direito processual');
  await expect(mainWindow.locator('#preview .document-summary h3')).toHaveText(
    'Lei de Introdução revisada no E2E',
  );

  await mainWindow.getByRole('button', { name: 'Validar revisão' }).click();
  await expect(mainWindow.locator('.editorial-toolbar')).toContainText('Validação completa');
  await mainWindow.getByRole('button', { name: 'Aprovar preview' }).click();
  await expect(mainWindow.getByRole('button', { name: 'Preview aprovado' })).toBeVisible();
  await mainWindow.getByRole('button', { name: 'Exportar Markdown' }).click();
  await expect(mainWindow.locator('.export-message')).toContainText(
    'lindb-metadados-exportados.md exportado no perfil lei completa',
  );
  const exported = await readFile(exportPath, 'utf8');
  expect(exported).toContain('title: "Lei de Introdução revisada no E2E"');
  expect(exported).toContain('ramo: "Direito processual"');

  const projectId = await panel.getAttribute('data-project-id');
  if (projectId === null) throw new Error('Painel sem projeto opaco associado.');
  const currentMetadata = await mainWindow.evaluate(async (opaqueProjectId) => {
    const api = (
      globalThis as unknown as {
        lexDesktop?: {
          metadata: {
            getState(input: {
              projectId: string;
            }): Promise<{ ok: true; value: MetadataStateDto } | { ok: false; error: unknown }>;
          };
        };
      }
    ).lexDesktop;
    const result = await api?.metadata.getState({ projectId: opaqueProjectId });
    return result?.ok === true ? result.value : null;
  }, projectId);
  if (currentMetadata === null) throw new Error('Estado de metadados indisponível no E2E.');

  await replaceMetadataStateHandler(app, withIdentityState(currentMetadata, 'published'));
  await mainWindow.getByLabel('Somente texto vigente').click();
  await expect(mainWindow.getByLabel('Somente texto vigente')).toBeChecked();
  await editButton.press('Enter');
  await expect(panel.getByLabel('Sigla')).toBeDisabled();
  await expect(
    panel.getByText('Identidade bloqueada porque a lei já foi publicada.').first(),
  ).toBeVisible();
  await cancelButton.press('Enter');

  await replaceMetadataStateHandler(app, withIdentityState(currentMetadata, 'never_published'));
  await mainWindow.getByLabel('Lei completa').click();
  await expect(mainWindow.getByLabel('Lei completa')).toBeChecked();
  await editButton.press('Enter');
  await expect(panel.getByLabel('Sigla')).toBeEnabled();
  await panel.getByLabel('Sigla').fill('lindbteste');
  await cancelButton.press('Enter');

  await editButton.press('Enter');
  await panel.getByLabel('Título').fill('Rascunho preservado em conflito');
  await panel.getByLabel('Motivo da alteração').fill('Teste de concorrência editorial.');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('metadata:update');
    ipcMain.handle('metadata:update', () => ({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'A revisão mudou; recarregue os dados antes de confirmar novamente.',
        retryable: true,
      },
    }));
  });
  await reviewButton.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await mainWindow.keyboard.press('Tab');
  await mainWindow.keyboard.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('rascunho local foi preservado');
  await expect(panel.getByLabel('Título')).toHaveValue('Rascunho preservado em conflito');

  const reloadButton = panel.getByRole('button', { name: 'Carregar revisão atual' });
  await reloadButton.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toContainText('rascunho local foi preservado');
  await expect(panel.getByLabel('Título')).toHaveValue('Rascunho preservado em conflito');

  await panel.getByRole('button', { name: 'Voltar ao preview' }).focus();
  await mainWindow.keyboard.press('Enter');
  await expect(mainWindow.locator('#preview-title')).toBeFocused();
});
