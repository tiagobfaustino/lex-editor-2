import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { build } from 'esbuild';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createPublicationAuditFixture } from './support/publication-audit-fixture.js';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const harnessPath = join(appDirectory, 'output/playwright/publication-audit-harness.mjs');
let fixture: Awaited<ReturnType<typeof createPublicationAuditFixture>> | undefined;
let app: ElectronApplication | undefined;
let mainWindow: Page;

test.beforeAll(async () => {
  fixture = await createPublicationAuditFixture();
  await build({
    entryPoints: [join(appDirectory, 'tests/e2e/support/publication-audit-harness.ts')],
    outfile: harnessPath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'external',
  });
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !['ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE'].includes(entry[0]),
    ),
  );
  app = await electron.launch({
    args: [appDirectory],
    env: {
      ...inherited,
      XDG_CONFIG_HOME: join(fixture.root, 'config'),
      LEX_EDITOR_E2E_SOURCE_CATALOG: '1',
      LEX_EDITOR_E2E_SOURCE_CATALOG_MODULE: harnessPath,
      LEX_EDITOR_E2E_PUBLICATION_CONTAINER: fixture.containerName,
    },
  });
  mainWindow = await app.firstWindow();
  await mainWindow.waitForLoadState('domcontentloaded');
});
test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  await rm(harnessPath, { force: true });
});

test('administrador encontra publicação originada do publisher real em três filtros', async () => {
  if (fixture === undefined) throw new Error('Publication fixture is unavailable.');
  const navigation = mainWindow.getByRole('link', { name: /Logs e diagnóstico/u });
  await navigation.focus();
  await mainWindow.keyboard.press('Enter');
  // Exactly three filter values: known law, module, and authoritative terminal.
  await mainWindow.getByLabel('Lei (ID)').fill(fixture.lawId);
  await mainWindow.getByLabel('Módulo').selectOption('publication');
  await mainWindow.getByLabel('Código ou mensagem').fill('publication_published');
  await mainWindow.getByRole('button', { name: 'Pesquisar eventos' }).focus();
  await mainWindow.keyboard.press('Enter');
  const terminal = mainWindow
    .locator('.audit-event-card')
    .filter({ hasText: 'publication_published' });
  await expect(terminal).toHaveCount(1);
  await expect(terminal).toContainText('publisher');
  await terminal.getByRole('button').focus();
  await mainWindow.keyboard.press('Enter');
  const detail = mainWindow.locator('.audit-detail');
  await expect(detail).toContainText(fixture.publicationId);
  await expect(detail).toContainText(fixture.candidateSha);
  expect(fixture.publishedVersionId).toMatch(/^[0-9a-f-]{36}$/u);
});
