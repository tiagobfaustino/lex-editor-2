import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const inheritedEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        key !== 'ELECTRON_RENDERER_URL' && key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
    ),
  ) as Record<string, string>;

test('Minhas leis recupera revisão editada após reinício e abre pelo teclado', async () => {
  const testInfo = test.info();
  const root = await mkdtemp(join(tmpdir(), 'lex-library-e2e-'));
  let app: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
      args: [appDirectory],
      env: { ...inheritedEnvironment(), XDG_CONFIG_HOME: join(root, 'config') },
    });
  try {
    const source = join(root, 'lindb.md');
    await writeFile(source, await readFile(join(appDirectory, 'fixtures/legal/lindb/esperado.md')));
    app = await launch();
    await app.evaluate(({ dialog }, path) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: () => Promise.resolve({ canceled: false, filePaths: [path] }),
      });
    }, source);
    let window = await app.firstWindow();
    await window.getByRole('tab', { name: 'Minhas leis' }).click();
    await expect(window.getByText('Sua biblioteca está vazia')).toBeVisible();
    await window.getByRole('tab', { name: 'Edição', exact: true }).click();
    await window.getByRole('button', { name: 'Selecionar arquivo local' }).click();
    await expect(window.locator('.document-state')).toContainText('lindb · 30 artigos');
    const panel = window.locator('#metadados');
    await panel.getByRole('button', { name: 'Editar metadados' }).click();
    await panel.getByLabel('Título').fill('LINDB da minha biblioteca');
    await panel.getByLabel('Motivo da alteração').fill('Título revisado para consulta local.');
    await panel.getByRole('button', { name: 'Revisar alterações' }).click();
    await window.getByRole('dialog').getByRole('button', { name: 'Confirmar e salvar' }).click();
    await expect(panel.getByRole('status')).toContainText('Metadados salvos');
    await window.getByLabel('Somente texto vigente').click();
    await expect(window.getByLabel('Somente texto vigente')).toBeChecked();
    const projectId = await panel.getAttribute('data-project-id');
    await app.close();
    app = undefined;
    app = await launch();
    window = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: () => Promise.resolve({ canceled: false, filePaths: [path] }),
      });
    }, source);
    const libraryTab = window.getByRole('tab', { name: 'Minhas leis' });
    await window.getByRole('tab', { name: 'Edição', exact: true }).focus();
    await window.keyboard.press('ArrowRight');
    await expect(libraryTab).toBeFocused();
    await expect(libraryTab).toHaveAttribute('aria-selected', 'true');
    const library = window.locator('#minhas-leis');
    await expect(library.getByRole('heading', { name: 'LINDB da minha biblioteca' })).toBeVisible();
    await library.getByLabel('Buscar por título ou sigla').fill('inexistente');
    await library.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(library.getByText('Nenhuma lei encontrada')).toBeVisible();
    await library.getByLabel('Buscar por título ou sigla').fill('biblioteca');
    await library.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(library.getByRole('heading', { name: 'LINDB da minha biblioteca' })).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath('minhas-leis.png'), fullPage: true });
    const open = library.getByRole('button', { name: /^Abrir LINDB/ });
    await open.focus();
    await window.keyboard.press('Enter');
    await expect(window.getByRole('tab', { name: 'Edição', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(window.locator('#preview .document-summary h3')).toHaveText(
      'LINDB da minha biblioteca',
    );
    await expect(window.locator('#metadados')).toHaveAttribute('data-project-id', projectId ?? '');
    await expect(window.getByLabel('Somente texto vigente')).toBeChecked();
    await expect(
      window.getByRole('button', { name: 'Exportar Markdown', exact: true }),
    ).toBeDisabled();
    await expect(window.locator('#preview-title')).toBeFocused();
    await window.getByRole('button', { name: 'Selecionar arquivo local' }).click();
    await expect(window.locator('.import-panel').getByRole('alert')).toContainText(
      'Esta lei já existe na base de dados',
    );
    await expect(window.locator('#metadados')).toHaveAttribute('data-project-id', projectId ?? '');
    await window.getByRole('tab', { name: 'Minhas leis' }).click();
    const remove = library.getByRole('button', { name: /^Excluir LINDB/ });
    await remove.click();
    const confirmation = window.getByRole('dialog', { name: 'Excluir esta lei?' });
    await expect(confirmation.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
    await window.keyboard.press('Escape');
    await expect(confirmation).not.toBeVisible();
    await expect(remove).toBeFocused();
    await remove.click();
    await confirmation.getByRole('button', { name: 'Confirmar exclusão' }).click();
    await expect(library.getByText('Lei excluída da biblioteca local.')).toBeVisible();
    await library.getByLabel('Buscar por título ou sigla').fill('');
    await library.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(library.getByText('Sua biblioteca está vazia')).toBeVisible();
    await window.getByRole('tab', { name: 'Edição', exact: true }).click();
    await expect(window.locator('#preview .document-summary')).not.toBeVisible();
    await app.close();
    app = undefined;
    app = await launch();
    window = await app.firstWindow();
    await window.getByRole('tab', { name: 'Minhas leis' }).click();
    await expect(window.getByText('Sua biblioteca está vazia')).toBeVisible();
    await window.getByRole('tab', { name: 'Edição', exact: true }).click();
    await app.evaluate(({ dialog }, path) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: () => Promise.resolve({ canceled: false, filePaths: [path] }),
      });
    }, source);
    await window.getByRole('button', { name: 'Selecionar arquivo local' }).click();
    await expect(window.locator('.document-state')).toContainText('lindb · 30 artigos');
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
