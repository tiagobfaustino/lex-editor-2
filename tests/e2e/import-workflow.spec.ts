import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (...parts: string[]): string => join(appDirectory, 'fixtures', 'legal', ...parts);

const inheritedEnvironment = (): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ELECTRON_RENDERER_URL' && key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

const configureDialogs = async (
  app: ElectronApplication,
  openPath: string,
  savePath: string,
): Promise<void> => {
  await app.evaluate(
    ({ dialog }, paths) => {
      const scope = globalThis as unknown as { __lexE2eOpenDialogCalls?: number };
      scope.__lexE2eOpenDialogCalls = 0;
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: () => {
          scope.__lexE2eOpenDialogCalls = (scope.__lexE2eOpenDialogCalls ?? 0) + 1;
          return Promise.resolve({ canceled: false, filePaths: [paths.openPath] });
        },
      });
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: () => Promise.resolve({ canceled: false, filePath: paths.savePath }),
      });
    },
    { openPath, savePath },
  );
};

let app: ElectronApplication;
let mainWindow: Page;
let temporaryRoot: string;
let maliciousSourcePath: string;
let canonicalSourcePath: string;
let extensiveSourcePath: string;
let ambiguousSourcePath: string;
let referenceSourcePath: string;
let referenceTargetPath: string;
let exportPath: string;
let l9099CompleteExportPath: string;
let l9099CurrentExportPath: string;

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'lex-feature-005-e2e-'));
  maliciousSourcePath = join(temporaryRoot, 'lindb-maliciosa.html');
  canonicalSourcePath = join(temporaryRoot, 'lindb-canonica.md');
  extensiveSourcePath = join(temporaryRoot, 'cf1988-extensa.md');
  ambiguousSourcePath = join(temporaryRoot, 'pena-ambigua.md');
  referenceSourcePath = join(temporaryRoot, 'nllc-referencias.md');
  referenceTargetPath = join(temporaryRoot, 'cf1988-referencias.md');
  exportPath = join(temporaryRoot, 'lindb-exportada.md');
  l9099CompleteExportPath = join(temporaryRoot, 'l9099-completa.md');
  l9099CurrentExportPath = join(temporaryRoot, 'l9099-vigente.md');

  const maliciousProbe = Buffer.from(
    '<script id="lex-xss-payload">globalThis.__lexXssExecuted=true;void globalThis.lexDesktop?.source?.selectLocal?.();</script><img src="x" onerror="globalThis.__lexXssExecuted=true">',
    'ascii',
  );
  await Promise.all([
    readFile(fixture('lindb', 'snapshot.html')).then((bytes) =>
      writeFile(maliciousSourcePath, Buffer.concat([bytes, maliciousProbe])),
    ),
    readFile(fixture('lindb', 'esperado.md')).then((bytes) =>
      writeFile(canonicalSourcePath, bytes),
    ),
    readFile(fixture('cf1988', 'esperado.md')).then((bytes) =>
      writeFile(extensiveSourcePath, bytes),
    ),
    writeFile(
      ambiguousSourcePath,
      `---
title: "Lei de teste editorial"
sigla: "lte"
tipo: "lei ordinária"
numero: "1"
ano: 2026
ramo: "teste"
fonte: "https://local.lex-editor.invalid/teste"
data_publicacao: 2026-08-10
data_atualizacao_legal: 2026-08-10
data_formatacao_vinculex: 2026-08-10
total_artigos: 1
versao_vinculex: "1.0.0"
legal_status: "vigente"
---

- Art. 1º Conduta principal:
  - § 1º Nas seguintes hipóteses:
    - I - praticar a conduta descrita:
      - Pena - reclusão, de um a dois anos.
`,
    ),
    readFile(fixture('nllc', 'esperado.md')).then((bytes) => writeFile(referenceSourcePath, bytes)),
    readFile(fixture('cf1988', 'esperado.md')).then((bytes) =>
      writeFile(referenceTargetPath, bytes),
    ),
  ]);

  app = await electron.launch({
    args: [appDirectory],
    env: {
      ...inheritedEnvironment(),
      XDG_CONFIG_HOME: join(temporaryRoot, 'config'),
    },
  });
  mainWindow = await app.firstWindow();
  await mainWindow.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  await rm(temporaryRoot, { recursive: true, force: true });
});

test('importa, navega por diagnóstico, bloqueia conteúdo ativo e exporta bytes canônicos', async () => {
  await configureDialogs(app, maliciousSourcePath, exportPath);

  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.getByText('Documento pronto para revisão e exportação')).toBeVisible({
    timeout: 30_000,
  });
  await expect(mainWindow.locator('.selected-source')).toContainText('lindb-maliciosa.html');
  await expect(mainWindow.locator('.document-state')).toContainText('del4657 · 30 artigos');
  await expect(mainWindow.locator('.preview-node').first()).toContainText('Art. 1');

  const xssEvidence = await mainWindow.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown> & {
      document: { querySelector(selector: string): unknown };
    };
    return {
      probe: scope['__lexXssExecuted'],
      injectedElement: scope.document.querySelector('#lex-xss-payload') !== null,
      process: typeof scope['process'],
    };
  });
  expect(xssEvidence).toEqual({ probe: undefined, injectedElement: false, process: 'undefined' });
  expect(
    await app.evaluate(
      () => (globalThis as unknown as { __lexE2eOpenDialogCalls?: number }).__lexE2eOpenDialogCalls,
    ),
  ).toBe(1);

  await configureDialogs(app, canonicalSourcePath, exportPath);
  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.locator('.selected-source')).toContainText('lindb-canonica.md');
  await expect(mainWindow.locator('.document-state')).toContainText('lindb · 30 artigos');

  const diagnostic = mainWindow.locator('.diagnostic-list button:not(:disabled)').first();
  await expect(diagnostic).toBeVisible();
  await diagnostic.click();
  await expect(mainWindow.locator('.preview-node.is-selected')).toBeVisible();

  await mainWindow.getByLabel('URL da fonte oficial').fill('https://attacker.example.com/admin');
  await mainWindow.getByRole('button', { name: 'Importar URL' }).click();
  await expect(mainWindow.locator('.import-panel').getByRole('alert')).toHaveText(
    'A URL ou o destino de rede não é permitido.',
  );
  await expect(mainWindow.locator('.document-state')).toContainText('lindb · 30 artigos');
  await expect(mainWindow.getByRole('button', { name: 'Exportar Markdown' })).toBeVisible();
  await expect(mainWindow.getByText('Salvo no diário local')).toBeVisible();
  await mainWindow.getByRole('button', { name: 'Aprovar preview' }).click();
  await expect(mainWindow.getByRole('button', { name: 'Preview aprovado' })).toBeVisible();

  await mainWindow.getByRole('button', { name: 'Preparar release' }).click();
  await expect(mainWindow.locator('#publicacao').getByRole('alert')).toBeVisible();
  await expect(mainWindow.locator('#publicacao')).not.toContainText('Publicado e confirmado');

  await mainWindow.getByRole('button', { name: 'Exportar Markdown' }).click();
  await expect(mainWindow.locator('.export-message')).toContainText(
    'lindb-exportada.md exportado no perfil lei completa, com integridade verificada.',
  );
  const exported = await readFile(exportPath);
  const exportedText = exported.toString('utf8');
  expect(exportedText).toMatch(/^---\n/u);
  expect(exportedText).toContain('total_artigos: 30');
  expect(exportedText).toContain('^lindb-art-1');
  expect(exportedText).not.toMatch(/lex-xss-payload|<script|onerror=/iu);
});

test('mantém o preview responsivo e paginado com a Constituição completa', async ({
  browserName: _browserName,
}, testInfo) => {
  void _browserName;
  await configureDialogs(app, extensiveSourcePath, join(temporaryRoot, 'cf1988-exportada.md'));
  const startedAt = Date.now();

  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.locator('.selected-source')).toContainText('cf1988-extensa.md');
  await expect(mainWindow.locator('.document-state')).toContainText('cf1988 · 411 artigos', {
    timeout: 30_000,
  });

  const elapsedMilliseconds = Date.now() - startedAt;
  testInfo.annotations.push({
    type: 'performance',
    description: `Importação e primeiro preview: ${String(elapsedMilliseconds)} ms`,
  });
  expect(elapsedMilliseconds).toBeLessThan(30_000);

  const initialNodeCount = await mainWindow.locator('.preview-node').count();
  expect(initialNodeCount).toBeLessThanOrEqual(25);
  await mainWindow
    .getByRole('button', { name: /^Expandir /u })
    .first()
    .click();
  await expect
    .poll(() => mainWindow.locator('.preview-node').count())
    .toBeGreaterThan(initialNodeCount);
  expect(await mainWindow.locator('.preview-node').count()).toBeLessThanOrEqual(
    initialNodeCount + 25,
  );

  const contentVisibility = await mainWindow
    .locator('.preview-tree-item')
    .first()
    .evaluate((element) => {
      const scope = globalThis as unknown as {
        getComputedStyle(target: unknown): { contentVisibility: string };
      };
      return scope.getComputedStyle(element).contentVisibility;
    });
  expect(contentVisibility).toBe('auto');

  const frameDelay = await mainWindow.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const scope = globalThis as unknown as {
          performance: { now(): number };
          requestAnimationFrame(callback: () => void): number;
        };
        const started = scope.performance.now();
        scope.requestAnimationFrame(() => {
          resolve(scope.performance.now() - started);
        });
      }),
  );
  testInfo.annotations.push({
    type: 'responsiveness',
    description: `Próximo frame: ${frameDelay.toFixed(1)} ms`,
  });
  expect(frameDelay).toBeLessThan(1_000);
  await testInfo.attach('preview-cf1988', {
    body: await mainWindow.screenshot(),
    contentType: 'image/png',
  });
  const reviewScreenshot = process.env['LEX_REVIEW_SCREENSHOT'];
  if (reviewScreenshot !== undefined) {
    await mainWindow.screenshot({ path: reviewScreenshot });
  }
});

test('abre preview acessível e navega entre referências internas e externas', async () => {
  await configureDialogs(app, referenceTargetPath, join(temporaryRoot, 'cf-referencias.md'));
  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.locator('.document-state')).toContainText('cf1988 · 411 artigos', {
    timeout: 30_000,
  });
  await configureDialogs(app, referenceSourcePath, join(temporaryRoot, 'nllc-exportada.md'));
  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.locator('.document-state')).toContainText('nllc · 1 artigos', {
    timeout: 30_000,
  });
  await mainWindow.getByRole('button', { name: 'Expandir Art. 1' }).click();

  const external = mainWindow
    .locator('.legal-reference-link')
    .filter({ hasText: 'caput do art. 37' });
  await external.hover();
  const popover = mainWindow.locator('.legal-reference-popover');
  await expect(popover).toContainText('Constituição da República Federativa do Brasil de 1988');
  await expect(popover).toContainText('Art. 37');
  await expect(popover).toContainText('A administração pública direta e indireta');

  await external.focus();
  await mainWindow.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(external).toBeFocused();

  await external.click();
  await expect(mainWindow.locator('.document-state')).toContainText('cf1988 · 411 artigos');
  await expect(mainWindow.locator('.preview-node.is-selected')).toContainText('Art. 37');
  await mainWindow.getByRole('button', { name: 'Voltar à referência' }).click();
  await expect(mainWindow.locator('.document-state')).toContainText('nllc · 1 artigos');
  await expect(external).toBeFocused();

  await mainWindow.getByRole('button', { name: 'Recolher Art. 1' }).click();
  await mainWindow.getByRole('button', { name: 'Expandir Art. 1' }).click();

  const internal = mainWindow.locator('.legal-reference-link').filter({ hasText: '§ 3º' });
  await internal.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(mainWindow.locator('.preview-node.is-selected')).toContainText(
    'Nas licitações e contratações que envolvam recursos provenientes de empréstimo',
  );
});

test('importa, corrige, valida, aprova e exporta uma interpretação de baixa confiança', async () => {
  const correctedExportPath = join(temporaryRoot, 'pena-revisada.md');
  await configureDialogs(app, ambiguousSourcePath, correctedExportPath);
  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();

  await expect(mainWindow.locator('.selected-source')).toContainText('pena-ambigua.md');
  await expect(mainWindow.getByText('Revisão obrigatória')).toBeVisible({ timeout: 30_000 });
  await expect(mainWindow.getByText('human_review_required')).toBeVisible();
  await expect(mainWindow.getByRole('button', { name: 'Exportar Markdown' })).toBeDisabled();

  await mainWindow
    .getByLabel('Interpretação textual atual')
    .fill('Pena - reclusão, de dois a três anos.');
  await mainWindow
    .getByLabel('Motivo editorial')
    .fill('Texto literal conferido no snapshot oficial da fonte.');
  await mainWindow.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(mainWindow.getByLabel('Interpretação textual atual')).toHaveValue(
    'Pena - reclusão, de dois a três anos.',
  );
  await expect(mainWindow.getByText('Validação incremental')).toBeVisible();

  await mainWindow
    .getByLabel('Motivo editorial')
    .fill('A pena pertence ao inciso após conferência da estrutura oficial.');
  await mainWindow.getByRole('button', { name: 'Confirmar interpretação' }).click();
  await expect(mainWindow.getByText('Revisão obrigatória')).toHaveCount(0);
  await mainWindow.getByRole('button', { name: 'Validar revisão' }).click();
  await expect(mainWindow.getByText('Validação completa')).toBeVisible();
  await mainWindow.getByRole('button', { name: 'Aprovar preview' }).click();
  await expect(mainWindow.getByRole('button', { name: 'Exportar Markdown' })).toBeEnabled();
  await mainWindow.getByRole('button', { name: 'Exportar Markdown' }).click();
  await expect(mainWindow.locator('.export-message')).toContainText(
    'pena-revisada.md exportado no perfil lei completa, com integridade verificada.',
  );

  const exported = await readFile(correctedExportPath, 'utf8');
  expect(exported).toContain('Pena - reclusão, de dois a três anos.');
  expect(exported).toContain('^lte-art-1-par-1-inc-i-pena');
});

test('alterna e exporta as duas projeções da Lei 9.099 sem duplicar Block IDs', async () => {
  await configureDialogs(app, fixture('l9099', 'snapshot.html'), l9099CompleteExportPath);
  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.getByText('Documento pronto para revisão e exportação')).toBeVisible({
    timeout: 30_000,
  });
  await expect(mainWindow.getByRole('radio', { name: /Lei completa/u })).toBeChecked();
  await mainWindow.getByRole('button', { name: 'Aprovar preview' }).click();
  await expect(mainWindow.getByRole('button', { name: 'Preview aprovado' })).toBeVisible();
  await mainWindow.getByRole('button', { name: 'Exportar Markdown' }).click();
  await expect(mainWindow.locator('.export-message')).toContainText(
    'l9099-completa.md exportado no perfil lei completa, com integridade verificada.',
  );

  const complete = await readFile(l9099CompleteExportPath, 'utf8');
  expect(complete).toContain('~~Art. 61. Consideram-se infrações penais');
  expect(complete.match(/\^l9099-art-61\b/gu)).toHaveLength(1);

  await mainWindow.getByRole('radio', { name: /Somente texto vigente/u }).click();
  await expect(mainWindow.getByRole('radio', { name: /Somente texto vigente/u })).toBeChecked();
  await configureDialogs(app, fixture('l9099', 'snapshot.html'), l9099CurrentExportPath);
  await mainWindow.getByRole('button', { name: 'Exportar Markdown' }).click();
  await expect(mainWindow.locator('.export-message')).toContainText(
    'l9099-vigente.md exportado no perfil somente vigente, com integridade verificada.',
  );

  const current = await readFile(l9099CurrentExportPath, 'utf8');
  expect(current).toContain('projection_profile: "current_only"');
  expect(current).not.toContain('pena máxima não superior a um ano');
  expect(current).not.toContain('~~');
  expect(current).toContain('^l9099-art-61');

  await mainWindow.getByRole('radio', { name: /Lei completa/u }).click();
  await expect(mainWindow.getByRole('radio', { name: /Lei completa/u })).toBeChecked();
});
