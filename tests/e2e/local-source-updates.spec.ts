import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const html = (text: string) =>
  Buffer.from(
    `<html><body><p>DECRETO-LEI Nº 4.657, DE 1942</p><p>Art. 1. ${text}</p><p>Art. 2. Artigo mantido integralmente.</p></body></html>`,
    'latin1',
  );
const env = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        key !== 'ELECTRON_RENDERER_URL' && key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
    ),
  ) as Record<string, string>;

test('biblioteca confere, cancela, atualiza, recupera e exporta relatório com lei integral', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lex-source-update-e2e-'));
  const harness = join(root, 'harness.mjs');
  const source = join(root, 'fonte.html');
  const destination = join(root, 'export');
  let app: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
      args: [appDirectory],
      env: {
        ...env(),
        XDG_CONFIG_HOME: join(root, 'config'),
        LEX_EDITOR_E2E_SOURCE_CATALOG: '1',
        LEX_EDITOR_E2E_SOURCE_CATALOG_MODULE: harness,
        LEX_SOURCE_UPDATE_TEST_HTML: source,
      },
    });
  try {
    await mkdir(destination);
    await writeFile(source, html('Redação original.'));
    await build({
      entryPoints: [join(appDirectory, 'tests/e2e/support/local-source-update-harness.ts')],
      outfile: harness,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      packages: 'external',
    });
    // Node resolves installed workspace packages from the repository, even for the isolated harness.
    const { symlink } = await import('node:fs/promises');
    await symlink(join(appDirectory, 'node_modules'), join(root, 'node_modules'), 'dir');
    app = await launch();
    let window = await app.firstWindow();
    await window
      .getByLabel('URL da fonte oficial')
      .fill('https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm');
    await window.getByRole('button', { name: 'Importar URL', exact: true }).click();
    await expect(window.locator('.document-state')).toContainText('2 artigos');
    await window.getByRole('tab', { name: 'Minhas leis', exact: true }).click();
    const checkButton = window.getByRole('button', { name: /^Verificar alterações / });
    await checkButton.click();
    let review = window.getByRole('dialog', { name: 'Conferência da fonte' });
    await expect(review).toContainText('Nenhuma alteração jurídica');
    await expect(review.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
    await window.keyboard.press('Escape');
    await expect(review).not.toBeVisible();
    await expect(checkButton).toBeFocused();
    await writeFile(source, html('Redação oficial atualizada.'));
    await checkButton.click();
    await expect(review).toContainText('Redação original.');
    await expect(review).toContainText('Redação oficial atualizada.');
    await window.keyboard.press('Escape');
    await expect(review).not.toBeVisible();
    await checkButton.click();
    await review.getByLabel('Conferi as alterações e os avisos de dispositivos ausentes.').check();
    await review.getByLabel('Motivo da atualização').fill('Conferência manual da fonte oficial.');
    await review.getByRole('button', { name: 'Confirmar atualização', exact: true }).click();
    await expect(window.getByRole('tab', { name: 'Edição', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(window.locator('#preview')).toContainText('Redação oficial atualizada.');
    await expect(
      window.getByRole('button', { name: 'Exportar Markdown', exact: true }),
    ).toBeDisabled();
    await app.close();
    app = undefined;
    app = await launch();
    window = await app.firstWindow();
    await window.getByRole('tab', { name: 'Minhas leis', exact: true }).click();
    await window.getByRole('button', { name: /^Verificar alterações / }).click();
    review = window.getByRole('dialog', { name: 'Conferência da fonte' });
    await expect(review).toContainText('Nenhuma alteração jurídica');
    await review.getByRole('button', { name: 'Fechar', exact: true }).click();
    await window.getByRole('button', { name: /^Abrir / }).click();
    await window.getByRole('button', { name: 'Validar revisão', exact: true }).click();
    await window.getByRole('button', { name: 'Aprovar preview', exact: true }).click();
    await expect(
      window.getByRole('button', { name: 'Exportar Markdown', exact: true }),
    ).toBeEnabled();
    await app.evaluate(({ dialog }, path) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: () => Promise.resolve({ canceled: false, filePaths: [path] }),
      });
    }, destination);
    await window.getByRole('tab', { name: 'Minhas leis', exact: true }).click();
    await window.getByRole('button', { name: /^Exportar lei e relatório / }).click();
    await expect(window.locator('#minhas-leis')).toContainText('Pacote exportado');
    const folders = await readdir(join(destination, 'leis'));
    const folder = folders[0];
    if (folder === undefined) throw new Error('No export');
    const report = await readFile(join(destination, 'leis', folder, 'ALTERACOES.md'), 'utf8');
    expect(report).toContain('Redação original.');
    expect(report).toContain('Redação oficial atualizada.');
    const files = await readdir(join(destination, 'leis', folder));
    const law = files.find((file) => file !== 'UPDATE.md' && file !== 'ALTERACOES.md');
    if (law === undefined) throw new Error('No law');
    expect(await readFile(join(destination, 'leis', folder, law), 'utf8')).toContain(
      'Artigo mantido integralmente.',
    );
    await window.screenshot({
      path: test.info().outputPath('lei-e-relatorio.png'),
      fullPage: true,
    });
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
