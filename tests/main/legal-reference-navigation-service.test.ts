import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatar, identifiedMinima, type IdentifiedNormaAST } from '@lex-editor/legal-domain';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalProjectService } from '../../src/main/local-project-service.js';
import type { PreviewNodeDto, ProgressDto } from '../../src/shared/ipc/import.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;

const constitution = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = 'Constituição da República Federativa do Brasil de 1988';
  ast.sigla = 'CF1988';
  ast.tipoNorma = 'constituição';
  ast.numero = '1988';
  ast.ano = 1988;
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture mínima sem artigo.');
  article.numero = '37';
  article.blockId = 'cf1988-art-37';
  article.caput = 'A administração pública obedecerá aos princípios constitucionais.';
  return ast;
};

const sourceLaw = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = 'Lei nº 14.133, de 1º de abril de 2021';
  ast.sigla = 'NLLC';
  ast.tipoNorma = 'lei ordinária';
  ast.numero = '14.133';
  ast.ano = 2021;
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture mínima sem artigo.');
  article.blockId = 'nllc-art-1';
  article.caput = 'Esta Lei estabelece normas gerais de licitação.';
  const common = {
    sourceRef: article.sourceRef,
    parseEvidence: article.parseEvidence,
    deviceStatus: 'active' as const,
    children: [] as [],
  };
  article.children = [
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-3-node',
      ordem: 0,
      blockId: 'nllc-art-1-par-3',
      numero: '3',
      texto: 'Nas licitações serão observadas as condições legais.',
    },
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-4-node',
      ordem: 1,
      blockId: 'nllc-art-1-par-4',
      numero: '4',
      texto: 'A documentação de que trata o § 3º deste artigo será apresentada.',
    },
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-5-node',
      ordem: 2,
      blockId: 'nllc-art-1-par-5',
      numero: '5',
      texto: 'Aplicam-se os princípios previstos no caput do art. 37 da Constituição Federal.',
    },
  ];
  return ast;
};

const canonicalMarkdown = (ast: IdentifiedNormaAST): string => {
  const result = formatar(ast);
  if (!result.ok) throw new Error(JSON.stringify(result.problemas));
  return result.valor;
};

const allPreviewNodes = async (
  service: ReturnType<typeof createLocalProjectService>,
  projectId: string,
  parentPreviewNodeId: string | null = null,
): Promise<PreviewNodeDto[]> => {
  const page = await service.getPreviewPage.handle({
    projectId,
    parentPreviewNodeId,
    cursor: null,
    limit: 50,
  });
  const descendants = await Promise.all(
    page.items.map((node) => allPreviewNodes(service, projectId, node.previewNodeId)),
  );
  return [...page.items, ...descendants.flat()];
};

describe('preview e navegação de referências jurídicas', () => {
  it('re-resolve o catálogo, entrega DTO sanitizado e navega por IDs opacos', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lex-reference-navigation-'));
    roots.push(root);
    const nllcPath = join(root, 'nllc.md');
    const cfPath = join(root, 'cf1988.md');
    const editorialPath = join(root, 'editorial.md');
    const maliciousPath = join(root, 'lindb-maliciosa.html');
    await writeFile(nllcPath, canonicalMarkdown(sourceLaw()));
    await writeFile(cfPath, canonicalMarkdown(constitution()));
    await writeFile(
      maliciousPath,
      Buffer.concat([
        await readFile(join(process.cwd(), 'fixtures', 'legal', 'lindb', 'snapshot.html')),
        Buffer.from('<script>globalThis.compromised=true</script>', 'ascii'),
      ]),
    );
    await writeFile(
      editorialPath,
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
    );

    let selectedPath = nllcPath;
    let resolveTerminal: ((progress: ProgressDto) => void) | undefined;
    const service = createLocalProjectService({
      storageRoot: join(root, 'workspace'),
      dialog: {
        showOpenDialog: vi.fn(() =>
          Promise.resolve({ canceled: false, filePaths: [selectedPath] }),
        ),
        showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true })),
      },
      getMainWindow: () => ({}) as BrowserWindow,
      sendProgress: (progress) => {
        if (['completed', 'failed', 'cancelled'].includes(progress.jobStatus)) {
          resolveTerminal?.(progress);
          resolveTerminal = undefined;
        }
      },
      now: () => new Date('2026-08-12T12:00:00.000Z'),
    });

    const processSelected = async (): Promise<string> => {
      const terminal = new Promise<ProgressDto>((resolve) => {
        resolveTerminal = resolve;
      });
      const selected = await service.selectLocal.handle({});
      if (selected === null) throw new Error('Seleção cancelada.');
      const accepted = await service.startProcessing.handle({ sourceId: selected.sourceId });
      const terminalProgress = await terminal;
      if (terminalProgress.jobStatus !== 'completed') throw new Error(terminalProgress.message);
      return accepted.projectId;
    };

    const sourceProjectId = await processSelected();
    const beforeCatalog = await allPreviewNodes(service, sourceProjectId);
    const internalBefore = beforeCatalog
      .flatMap((node) => node.legalReferences)
      .find(({ label }) => label.includes('§ 3º'));
    const externalBefore = beforeCatalog
      .flatMap((node) => node.legalReferences)
      .find(({ label }) => label.includes('art. 37'));
    expect(internalBefore?.state).toBe('resolved');
    expect(externalBefore?.state).toBe('unresolved');

    selectedPath = cfPath;
    const targetProjectId = await processSelected();
    const afterCatalog = await allPreviewNodes(service, sourceProjectId);
    const internal = afterCatalog
      .flatMap((node) => node.legalReferences)
      .find(({ label }) => label.includes('§ 3º'));
    const external = afterCatalog
      .flatMap((node) => node.legalReferences)
      .find(({ label }) => label.includes('art. 37'));
    if (internal === undefined || external === undefined) throw new Error('Referências ausentes.');
    expect([internal.state, external.state]).toEqual(['resolved', 'resolved']);

    const internalPreview = await service.getLegalReference.handle({
      projectId: sourceProjectId,
      referenceId: internal.referenceId,
    });
    expect(internalPreview).toMatchObject({
      targetSigla: 'NLLC',
      targetPlainText: 'Nas licitações serão observadas as condições legais.',
      external: false,
    });
    expect(internalPreview.targetLegalPath).toContain('§ 3');
    const externalPreview = await service.getLegalReference.handle({
      projectId: sourceProjectId,
      referenceId: external.referenceId,
    });
    expect(externalPreview).toMatchObject({
      targetSigla: 'CF1988',
      targetPlainText: 'A administração pública obedecerá aos princípios constitucionais.',
      external: true,
    });
    expect(externalPreview.targetLegalPath).toContain('Art. 37');
    expect(externalPreview).not.toHaveProperty('path');
    expect(externalPreview).not.toHaveProperty('html');

    const destination = await service.navigateLegalReference.handle({
      projectId: sourceProjectId,
      referenceId: external.referenceId,
    });
    expect(destination).toMatchObject({ targetProjectId, external: true });
    const revealed = await service.revealPreviewNode.handle({
      projectId: destination.targetProjectId,
      previewNodeId: destination.targetPreviewNodeId,
    });
    expect(revealed.items.at(-1)?.blockId).toBe('cf1988-art-37');
    expect(
      await service.getLegalReference.authorize({
        projectId: '00000000-0000-4000-8000-000000000000',
        referenceId: external.referenceId,
      }),
    ).toBe(false);

    selectedPath = join(process.cwd(), 'fixtures', 'legal', 'lindb', 'esperado.md');
    expect(await processSelected()).toMatch(/[0-9a-f-]{36}/u);
    selectedPath = join(process.cwd(), 'fixtures', 'legal', 'lindb', 'snapshot.html');
    expect(await processSelected()).toMatch(/[0-9a-f-]{36}/u);
    selectedPath = maliciousPath;
    expect(await processSelected()).toMatch(/[0-9a-f-]{36}/u);
    selectedPath = join(process.cwd(), 'fixtures', 'legal', 'lindb', 'esperado.md');
    expect(await processSelected()).toMatch(/[0-9a-f-]{36}/u);
    selectedPath = editorialPath;
    expect(await processSelected()).toMatch(/[0-9a-f-]{36}/u);
  });
});
