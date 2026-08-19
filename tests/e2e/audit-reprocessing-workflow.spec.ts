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
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: () => Promise.resolve({ canceled: false, filePaths: [paths.openPath] }),
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
let unreadableSourcePath: string;
let lindbSourcePath: string;

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'lex-feature-013-grupo5-e2e-'));
  unreadableSourcePath = join(temporaryRoot, 'fonte-sem-conteudo-juridico.html');
  lindbSourcePath = join(temporaryRoot, 'lindb.md');

  await Promise.all([
    writeFile(
      unreadableSourcePath,
      '<!DOCTYPE html><html><head><title>Vazio</title></head><body></body></html>',
    ),
    readFile(fixture('lindb', 'esperado.md')).then((bytes) => writeFile(lindbSourcePath, bytes)),
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

test('investiga um incidente, abre evidência, reprocessa o projeto aberto e volta ao preview', async () => {
  // Etapa 1 — uma fonte sem conteúdo jurídico reconhecível gera um incidente
  // com evidência anexada, sem travar o restante do fluxo.
  await configureDialogs(app, unreadableSourcePath, join(temporaryRoot, 'nao-usado.md'));
  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.locator('.import-panel').getByRole('alert')).toHaveText(
    'A fonte não contém uma norma jurídica reconhecível',
    { timeout: 30_000 },
  );

  // Etapa 2 — importa uma lei real com sucesso; este é o projeto que será
  // reprocessado mais adiante.
  await configureDialogs(app, lindbSourcePath, join(temporaryRoot, 'lindb-exportada.md'));
  await mainWindow.getByRole('button', { name: 'Selecionar arquivo local' }).click();
  await expect(mainWindow.getByText('Documento pronto para revisão e exportação')).toBeVisible({
    timeout: 30_000,
  });
  await expect(mainWindow.locator('.document-state')).toContainText('lindb · 30 artigos');

  // Etapa 3 — abre Logs e diagnóstico pela navegação principal (por teclado).
  const auditNavLink = mainWindow.getByRole('link', { name: /Logs e diagnóstico/u });
  await auditNavLink.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(mainWindow.locator('#auditoria')).toBeVisible();

  // Etapa 4 — localiza a correlação da importação com até três filtros:
  // código/mensagem, módulo e período. O incidente pertence ao projeto que
  // falhou na Etapa 1, não ao projeto aberto agora, então a busca precisa
  // olhar além do projeto corrente.
  await mainWindow.getByLabel('Somente o projeto aberto').uncheck();
  await mainWindow.getByLabel('Código ou mensagem').fill('extraction');
  await mainWindow.getByLabel('Módulo').selectOption('extraction');
  const today = new Date().toISOString().slice(0, 10);
  await mainWindow.getByLabel('Início').fill(today);
  await mainWindow.getByRole('button', { name: 'Pesquisar eventos' }).click();
  await expect(mainWindow.locator('.audit-event-list li').first()).toBeVisible();

  // Etapa 5 — abre o evento com incidente (o `extraction_failed` da Etapa 1).
  const incidentEvent = mainWindow
    .locator('.audit-event-card')
    .filter({ has: mainWindow.locator('.audit-badge-incident') })
    .first();
  await expect(incidentEvent).toBeVisible();
  await incidentEvent.locator('button').focus();
  await mainWindow.keyboard.press('Enter');
  await expect(mainWindow.locator('.audit-detail')).toContainText('extraction');

  const openIncidentButton = mainWindow.getByRole('button', { name: 'Ver incidente' });
  await openIncidentButton.focus();
  await mainWindow.keyboard.press('Enter');
  const incidentDialog = mainWindow.getByRole('dialog', { name: 'Incidente' });
  await expect(incidentDialog).toBeVisible();
  await expect(incidentDialog).toContainText('Aberto');

  // Etapa 6 — autoriza e consulta o trecho restrito de evidência.
  const openEvidenceButton = mainWindow.getByRole('button', { name: 'Abrir evidência' }).first();
  await openEvidenceButton.focus();
  await mainWindow.keyboard.press('Enter');
  const evidenceDialog = mainWindow.getByRole('dialog', { name: 'Evidência' });
  await expect(evidenceDialog).toBeVisible();
  const authorizeButton = evidenceDialog.getByRole('button', { name: 'Autorizar abertura' });
  await authorizeButton.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(evidenceDialog.locator('.audit-evidence-excerpt')).toBeVisible();
  await evidenceDialog.getByRole('button', { name: 'Fechar' }).focus();
  await mainWindow.keyboard.press('Enter');
  await expect(evidenceDialog).toBeHidden();

  await incidentDialog.getByRole('button', { name: 'Fechar' }).focus();
  await mainWindow.keyboard.press('Enter');
  await expect(incidentDialog).toBeHidden();

  // Etapa 7 — reprocessa o projeto aberto (a lei importada com sucesso na
  // Etapa 2), acompanha o resultado e confirma que o texto/hash permanecem os
  // mesmos por não ter havido mudança de fonte.
  const reprocessTrigger = mainWindow.getByRole('button', { name: 'Reprocessar projeto aberto' });
  await reprocessTrigger.focus();
  await mainWindow.keyboard.press('Enter');
  await mainWindow
    .getByLabel('Motivo')
    .fill('Conferência periódica do parser sobre a lei já importada.');
  await mainWindow.getByRole('button', { name: 'Solicitar' }).click();

  const reprocessSection = mainWindow.locator('.audit-reprocess-section');
  const preview = reprocessSection.getByText('Voltar ao preview');
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(reprocessSection).toContainText('Status: Concluído');

  await preview.focus();
  await mainWindow.keyboard.press('Enter');
  await expect(mainWindow.locator('#preview')).toBeVisible();
  await expect(mainWindow.locator('.document-state')).toContainText('lindb · 30 artigos');
});
