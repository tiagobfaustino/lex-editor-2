import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow, OpenDialogOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalProjectService } from '../../src/main/local-project-service.js';
import type { PlanaltoNetworkPorts } from '../../src/main/import/planalto-source.js';
import type { PreviewNodeDto, ProgressDto } from '../../src/shared/ipc/import.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'lex-local-project-'));
  roots.push(root);
  return root;
};

const fixture = (path: string): string => join(process.cwd(), 'fixtures', 'legal', 'lindb', path);

const setup = async (
  selectedPath: string,
  destinationPath: string,
  networkPorts?: PlanaltoNetworkPorts,
) => {
  const root = await makeRoot();
  let resolveTerminal: ((value: ProgressDto) => void) | undefined;
  const terminal = new Promise<ProgressDto>((resolve) => {
    resolveTerminal = resolve;
  });
  const progress: ProgressDto[] = [];
  const service = createLocalProjectService({
    storageRoot: join(root, 'workspace'),
    dialog: {
      showOpenDialog: vi.fn(() => Promise.resolve({ canceled: false, filePaths: [selectedPath] })),
      showSaveDialog: vi.fn(() => Promise.resolve({ canceled: false, filePath: destinationPath })),
    },
    getMainWindow: () => ({}) as BrowserWindow,
    sendProgress: (event) => {
      progress.push(event);
      if (['completed', 'failed', 'cancelled'].includes(event.jobStatus)) resolveTerminal?.(event);
    },
    now: () => new Date('2026-08-09T12:00:00.000Z'),
    ...(networkPorts === undefined ? {} : { networkPorts }),
  });
  return { root, service, terminal, progress };
};

const semanticTree = async (
  service: ReturnType<typeof createLocalProjectService>,
  projectId: string,
  parentPreviewNodeId: string | null = null,
): Promise<unknown[]> => {
  const nodes: PreviewNodeDto[] = [];
  let cursor: string | null = null;
  do {
    const page = await service.getPreviewPage.handle({
      projectId,
      parentPreviewNodeId,
      cursor,
      limit: 50,
    });
    nodes.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);

  return Promise.all(
    nodes.map(async (node) => ({
      nodeKind: node.nodeKind,
      order: node.order,
      label: node.label,
      plainText: node.plainText,
      blockId: node.blockId,
      deviceStatus: node.deviceStatus,
      histories: node.histories,
      children: await semanticTree(service, projectId, node.previewNodeId),
    })),
  );
};

describe('local project service', () => {
  it('preserva snapshot Markdown, projeta preview navegável e exporta bytes atomicamente', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb.md');
    const destinationPath = join(root, 'exportado.md');
    await writeFile(sourcePath, await readFile(fixture('esperado.md')));
    const setupResult = await setup(sourcePath, destinationPath);
    const selected = await setupResult.service.selectLocal.handle({});
    expect(selected).not.toBeNull();
    if (selected === null) return;

    await writeFile(sourcePath, '# arquivo original alterado depois do snapshot\n');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const document = await setupResult.service.getPreviewDocument.handle({
      projectId: accepted.projectId,
    });
    const rootPage = await setupResult.service.getPreviewPage.handle({
      projectId: accepted.projectId,
      parentPreviewNodeId: null,
      cursor: null,
      limit: 5,
    });
    const diagnostics = await setupResult.service.getDiagnosticPage.handle({
      projectId: accepted.projectId,
      cursor: null,
      limit: 100,
    });
    expect(document).toMatchObject({ sigla: 'lindb', totalArticles: 30 });
    expect(rootPage.items[0]).toMatchObject({ nodeKind: 'artigo', label: 'Art. 1' });
    expect(rootPage.nextCursor).not.toBeNull();
    expect(diagnostics.items.some((item) => item.previewNodeId !== null)).toBe(true);

    const first = rootPage.items[0];
    if (first === undefined) throw new Error('Preview vazio.');
    const children = await setupResult.service.getPreviewPage.handle({
      projectId: accepted.projectId,
      parentPreviewNodeId: first.previewNodeId,
      cursor: null,
      limit: 25,
    });
    expect(children.items[0]).toMatchObject({ nodeKind: 'paragrafo' });
    const path = await setupResult.service.revealPreviewNode.handle({
      projectId: accepted.projectId,
      previewNodeId: children.items[0]?.previewNodeId ?? '',
    });
    expect(path.items.map((item) => item.nodeKind)).toEqual(['artigo', 'paragrafo']);

    const validation = await setupResult.service.validateEditorial.handle({
      projectId: accepted.projectId,
    });
    expect(validation.canApprove).toBe(true);
    const approval = await setupResult.service.approveEditorial.handle({
      projectId: accepted.projectId,
    });
    expect(approval.canExport).toBe(true);

    const destination = await setupResult.service.chooseExportDestination.handle({
      projectId: accepted.projectId,
      projectionProfile: 'complete_with_history',
    });
    if (destination === null) throw new Error('Destino cancelado inesperadamente.');
    const exported = await setupResult.service.writeExport.handle({
      projectId: accepted.projectId,
      destinationId: destination.destinationId,
    });
    const bytes = await readFile(destinationPath);
    expect(bytes.byteLength).toBe(exported.byteLength);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(exported.markdownSha256);
    expect(bytes.toString('utf8')).toContain('^lindb-art-1');
    expect(exported.fileName).toBe('exportado.md');
  });

  it('alterna preview e exportação sem alterar revisão, aprovação ou diário editorial', async () => {
    const sourceRoot = await makeRoot();
    const sourcePath = join(sourceRoot, 'lindb.md');
    const destinationPath = join(sourceRoot, 'lindb-vigente.md');
    const sourceMarkdown = (await readFile(fixture('esperado.md'), 'utf8')).replace(
      '(Revogado pela Lei nº 12.036, de 2009). ^lindb-art-1-par-2',
      '(Revogado pela Lei nº 12.036, de 2009) ^lindb-art-1-par-2',
    );
    await writeFile(sourcePath, sourceMarkdown);
    const setupResult = await setup(sourcePath, destinationPath);
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    await setupResult.service.validateEditorial.handle({ projectId: accepted.projectId });
    await setupResult.service.approveEditorial.handle({ projectId: accepted.projectId });
    const initialDocument = await setupResult.service.getPreviewDocument.handle({
      projectId: accepted.projectId,
    });
    const initialState = await setupResult.service.getEditorialState.handle({
      projectId: accepted.projectId,
    });
    const initialTree = JSON.stringify(await semanticTree(setupResult.service, accepted.projectId));
    const journalPath = join(
      setupResult.root,
      'workspace',
      'editorial-projects',
      accepted.projectId,
      'journal.json',
    );
    const journalBefore = await readFile(journalPath, 'utf8');

    expect(initialDocument.projectionProfile).toBe('complete_with_history');
    expect(initialTree).toContain('lindb-art-1-par-2');
    await expect(
      setupResult.service.setPreviewProjectionProfile.handle({
        projectId: accepted.projectId,
        projectionProfile: 'current_only',
      }),
    ).resolves.toEqual({
      projectId: accepted.projectId,
      projectionProfile: 'current_only',
    });

    const currentDocument = await setupResult.service.getPreviewDocument.handle({
      projectId: accepted.projectId,
    });
    const currentState = await setupResult.service.getEditorialState.handle({
      projectId: accepted.projectId,
    });
    const currentTree = JSON.stringify(await semanticTree(setupResult.service, accepted.projectId));
    expect(currentDocument).toMatchObject({ projectionProfile: 'current_only' });
    expect(currentDocument.totalPreviewNodes).toBeLessThan(initialDocument.totalPreviewNodes);
    expect(currentTree).not.toContain('lindb-art-1-par-2');
    expect(currentState).toMatchObject({
      revisionHash: initialState.revisionHash,
      journalSequence: initialState.journalSequence,
      reviewApprovalStatus: 'approved',
      canExport: true,
    });
    expect(await readFile(journalPath, 'utf8')).toBe(journalBefore);

    const preferencePath = join(
      setupResult.root,
      'workspace',
      'editorial-projects',
      accepted.projectId,
      'projection-preference.json',
    );
    await expect(readFile(preferencePath, 'utf8')).resolves.toContain(
      '"projectionProfile":"current_only"',
    );

    const destination = await setupResult.service.chooseExportDestination.handle({
      projectId: accepted.projectId,
      projectionProfile: 'current_only',
    });
    if (destination === null) throw new Error('Destino cancelado inesperadamente.');
    const exported = await setupResult.service.writeExport.handle({
      projectId: accepted.projectId,
      destinationId: destination.destinationId,
    });
    const markdown = await readFile(destinationPath, 'utf8');
    expect(exported.projectionProfile).toBe('current_only');
    expect(markdown).toContain('projection_profile: "current_only"');
    expect(markdown).not.toContain('^lindb-art-1-par-2');

    await setupResult.service.setPreviewProjectionProfile.handle({
      projectId: accepted.projectId,
      projectionProfile: 'complete_with_history',
    });
    const restoredDocument = await setupResult.service.getPreviewDocument.handle({
      projectId: accepted.projectId,
    });
    const restoredTree = JSON.stringify(
      await semanticTree(setupResult.service, accepted.projectId),
    );
    expect(restoredDocument).toMatchObject({
      projectionProfile: 'complete_with_history',
      totalPreviewNodes: initialDocument.totalPreviewNodes,
    });
    expect(restoredTree).toContain('lindb-art-1-par-2');
    expect(await readFile(journalPath, 'utf8')).toBe(journalBefore);
  });

  it('exporta lote em pastas canônicas e isola uma lei não aprovada', async () => {
    const root = await makeRoot();
    const firstSource = join(root, 'lindb.md');
    const secondSource = join(root, 'cp.md');
    const batchRoot = join(root, 'lote');
    await Promise.all([
      writeFile(firstSource, await readFile(fixture('esperado.md'))),
      writeFile(secondSource, await readFile(join(process.cwd(), 'fixtures/legal/cp/esperado.md'))),
      mkdir(batchRoot),
    ]);
    const sourcePaths = [firstSource, secondSource];
    let terminalResolver: ((progress: ProgressDto) => void) | undefined;
    const dialog = {
      showOpenDialog: vi.fn((_window: BrowserWindow, options: OpenDialogOptions) =>
        Promise.resolve(
          options.properties?.includes('openDirectory') === true
            ? { canceled: false, filePaths: [batchRoot] }
            : { canceled: false, filePaths: [sourcePaths.shift() ?? firstSource] },
        ),
      ),
      showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true })),
    };
    const service = createLocalProjectService({
      storageRoot: join(root, 'workspace'),
      dialog,
      getMainWindow: () => ({}) as BrowserWindow,
      sendProgress: (progress) => {
        if (['completed', 'failed', 'cancelled'].includes(progress.jobStatus)) {
          terminalResolver?.(progress);
        }
      },
      now: () => new Date('2026-08-10T12:00:00.000Z'),
    });
    const processNext = async (): Promise<string> => {
      const selected = await service.selectLocal.handle({});
      if (selected === null) throw new Error('Seleção cancelada.');
      const terminal = new Promise<ProgressDto>((resolve) => {
        terminalResolver = resolve;
      });
      const accepted = await service.startProcessing.handle({ sourceId: selected.sourceId });
      await expect(terminal).resolves.toMatchObject({ jobStatus: 'completed' });
      return accepted.projectId;
    };

    const approvedProjectId = await processNext();
    await service.validateEditorial.handle({ projectId: approvedProjectId });
    await service.approveEditorial.handle({ projectId: approvedProjectId });
    const unapprovedProjectId = await processNext();

    const destination = await service.chooseBatchExportDestination.handle({
      projectIds: [approvedProjectId, unapprovedProjectId],
    });
    if (destination === null) throw new Error('Destino do lote cancelado.');
    const exported = await service.writeBatchExport.handle({
      destinationId: destination.destinationId,
    });

    expect(exported).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    const success = exported.results.find((result) => result.batchExportStatus === 'succeeded');
    const failure = exported.results.find((result) => result.batchExportStatus === 'failed');
    expect(failure).toMatchObject({ projectId: unapprovedProjectId, errorCode: 'NOT_APPROVED' });
    if (success?.batchExportStatus !== 'succeeded') throw new Error('Lei aprovada não exportada.');
    const lawDirectory = join(batchRoot, 'leis', success.directoryName);
    expect((await readdir(lawDirectory)).sort()).toEqual(['UPDATE.md', success.markdownFileName]);
    const update = await readFile(join(lawDirectory, 'UPDATE.md'), 'utf8');
    expect(update).toContain('# Atualizações');
    expect(update).toContain('## Publicação 1 — 2026-08-10');
    expect(update).toContain('**Tipo:** Publicação inicial');
    expect(update).toContain('Dispositivos incluídos');
    expect(update).not.toContain('CHANGELOG.md');
    expect(createHash('sha256').update(update).digest('hex')).toBe(success.updateSha256);
  });

  it('importa HTML do Planalto pela gramática injetada', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb.html');
    await writeFile(sourcePath, await readFile(fixture('snapshot.html')));
    const setupResult = await setup(sourcePath, join(root, 'lindb.md'));
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    await setupResult.service.startProcessing.handle({ sourceId: selected.sourceId });
    const terminal = await setupResult.terminal;
    expect(terminal.jobStatus).toBe('completed');
    expect(setupResult.progress.map((event) => event.phase)).toContain('preview_projection');
  });

  it('ignora decoração, wikilinks e Block IDs do Markdown pessoal ao importar', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'nllc-pessoal.md');
    await writeFile(
      sourcePath,
      await readFile(
        join(process.cwd(), 'fixtures/legal/nllc/markdown-pessoal-artigo-1.md'),
        'utf8',
      ),
    );
    const setupResult = await setup(sourcePath, join(root, 'nllc-normalizada.md'));
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const tree = JSON.stringify(await semanticTree(setupResult.service, accepted.projectId));
    expect(tree).toContain('nllc-art-1-par-4');
    expect(tree).toContain('nllc-art-1-par-5');
    expect(tree).toContain('caput do art. 37 da Constituição Federal');
    expect(tree).not.toMatch(/NavegaLei|77575b2|<mark>|<strong>|\[\[/u);
  });

  it('persiste correção, revalida e invalida aprovação ligada à revisão anterior', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb.md');
    await writeFile(sourcePath, await readFile(fixture('esperado.md')));
    const setupResult = await setup(sourcePath, join(root, 'lindb-revisada.md'));
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const initialState = await setupResult.service.getEditorialState.handle({
      projectId: accepted.projectId,
    });
    expect(initialState).toMatchObject({
      validationMode: 'full',
      validationIsComplete: true,
      canApprove: true,
      journalSequence: 0,
    });
    const approved = await setupResult.service.approveEditorial.handle({
      projectId: accepted.projectId,
    });
    expect(approved).toMatchObject({ reviewApprovalStatus: 'approved', canExport: true });

    const page = await setupResult.service.getPreviewPage.handle({
      projectId: accepted.projectId,
      parentPreviewNodeId: null,
      cursor: null,
      limit: 25,
    });
    const article = page.items[0];
    if (article === undefined) throw new Error('Preview sem artigo.');
    const corrected = await setupResult.service.correctEditorialText.handle({
      projectId: accepted.projectId,
      previewNodeId: article.previewNodeId,
      value: 'Art. 1º Texto corrigido e persistido pelo fluxo editorial.',
      reason: 'A transcrição foi conferida no snapshot oficial.',
    });
    expect(corrected).toMatchObject({
      journalSequence: 1,
      validationMode: 'incremental',
      validationIsComplete: false,
      reviewApprovalStatus: 'invalidated',
      canExport: false,
    });
    const updatedPage = await setupResult.service.getPreviewPage.handle({
      projectId: accepted.projectId,
      parentPreviewNodeId: null,
      cursor: null,
      limit: 25,
    });
    expect(updatedPage.items[0]?.plainText).toBe(
      'Art. 1º Texto corrigido e persistido pelo fluxo editorial.',
    );

    const journalPath = join(
      setupResult.root,
      'workspace',
      'editorial-projects',
      accepted.projectId,
      'journal.json',
    );
    const persisted = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: unknown[] };
    expect(persisted.entries).toHaveLength(1);

    const validated = await setupResult.service.validateEditorial.handle({
      projectId: accepted.projectId,
    });
    expect(validated).toMatchObject({ validationMode: 'full', canApprove: true });
    const reapproved = await setupResult.service.approveEditorial.handle({
      projectId: accepted.projectId,
    });
    expect(reapproved).toMatchObject({ reviewApprovalStatus: 'approved', canExport: true });
  });

  it('produz a mesma projeção semântica para URL e arquivo HTML equivalentes', async () => {
    const html = await readFile(fixture('snapshot.html'));
    const localRoot = await makeRoot();
    const localPath = join(localRoot, 'lindb-compilado.html');
    await writeFile(localPath, html);
    const local = await setup(localPath, join(localRoot, 'local.md'));
    const localSource = await local.service.selectLocal.handle({});
    if (localSource === null) throw new Error('Seleção local cancelada.');
    const localJob = await local.service.startProcessing.handle({ sourceId: localSource.sourceId });
    await expect(local.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const urlRoot = await makeRoot();
    const networkPorts: PlanaltoNetworkPorts = {
      resolveHost: vi.fn(() => Promise.resolve([{ address: '8.8.8.8', family: 4 as const }])),
      request: vi.fn(({ url }: Parameters<PlanaltoNetworkPorts['request']>[0]) =>
        Promise.resolve(
          url.pathname.includes('compilado')
            ? {
                statusCode: 200,
                headers: { 'content-type': 'text/html; charset=windows-1252' },
                body: html,
              }
            : {
                statusCode: 404,
                headers: { 'content-type': 'text/html' },
                body: Buffer.alloc(0),
              },
        ),
      ),
    };
    const remote = await setup(localPath, join(urlRoot, 'remote.md'), networkPorts);
    const remoteSource = await remote.service.importFromUrl.handle({
      url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm',
    });
    const remoteJob = await remote.service.startProcessing.handle({
      sourceId: remoteSource.sourceId,
    });
    await expect(remote.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const [localDocument, remoteDocument, localTree, remoteTree] = await Promise.all([
      local.service.getPreviewDocument.handle({ projectId: localJob.projectId }),
      remote.service.getPreviewDocument.handle({ projectId: remoteJob.projectId }),
      semanticTree(local.service, localJob.projectId),
      semanticTree(remote.service, remoteJob.projectId),
    ]);
    expect({
      title: remoteDocument.title,
      sigla: remoteDocument.sigla,
      legalStatus: remoteDocument.legalStatus,
      totalArticles: remoteDocument.totalArticles,
    }).toEqual({
      title: localDocument.title,
      sigla: localDocument.sigla,
      legalStatus: localDocument.legalStatus,
      totalArticles: localDocument.totalArticles,
    });
    expect(remoteTree).toEqual(localTree);
  });

  it('preserva cada variante do conjunto em snapshot imutável separado', async () => {
    const root = await makeRoot();
    const selectedPath = join(root, 'unused.html');
    await writeFile(selectedPath, '<html></html>');
    const ports: PlanaltoNetworkPorts = {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 }]),
      request: ({ url }) =>
        Promise.resolve({
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: Buffer.from(`<html>${url.pathname}</html>`),
        }),
    };
    const result = await setup(selectedPath, join(root, 'out.md'), ports);
    const source = await result.service.importFromUrl.handle({
      url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
    });
    const snapshotDirectory = join(result.root, 'workspace', 'sources', source.sourceId);
    const files = await readdir(snapshotDirectory);

    expect(files).toHaveLength(2);
    const stats = await Promise.all(files.map((file) => stat(join(snapshotDirectory, file))));
    expect(stats.every((value) => (value.mode & 0o777) === 0o600)).toBe(true);
  });

  it('alterna projeções de um par compilada/anotada sem perder histórico', async () => {
    const root = await makeRoot();
    const selectedPath = join(root, 'unused.html');
    await writeFile(selectedPath, '<html></html>');
    const officialSnapshot = await readFile(
      join(process.cwd(), 'fixtures/legal/l9099/snapshot.html'),
    );
    const ports: PlanaltoNetworkPorts = {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 }]),
      request: () =>
        Promise.resolve({
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: officialSnapshot,
        }),
    };
    const result = await setup(selectedPath, join(root, 'out.md'), ports);
    const source = await result.service.importFromUrl.handle({
      url: 'https://www.planalto.gov.br/ccivil_03/leis/l9099.htm',
    });
    const accepted = await result.service.startProcessing.handle({ sourceId: source.sourceId });
    const terminal = await result.terminal;
    if (terminal.jobStatus !== 'completed') throw new Error(JSON.stringify(terminal));

    const complete = JSON.stringify(await semanticTree(result.service, accepted.projectId));
    expect(complete).toContain('pena máxima não superior a um ano');
    expect(complete).toContain('l9099-art-61');
    await result.service.setPreviewProjectionProfile.handle({
      projectId: accepted.projectId,
      projectionProfile: 'current_only',
    });
    const current = JSON.stringify(await semanticTree(result.service, accepted.projectId));
    expect(current).not.toContain('pena máxima não superior a um ano');
    expect(current).toContain('l9099-art-61');

    const snapshotDirectory = join(result.root, 'workspace', 'sources', source.sourceId);
    expect(await readdir(snapshotDirectory)).toHaveLength(2);
  });

  it('cancela entre fases sem produzir documento exportável', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb.md');
    await writeFile(sourcePath, await readFile(fixture('esperado.md')));
    const setupResult = await setup(sourcePath, join(root, 'lindb.md'));
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await setupResult.service.cancelJob.handle({ jobId: accepted.jobId });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'cancelled' });
    expect(() =>
      setupResult.service.getPreviewDocument.handle({ projectId: accepted.projectId }),
    ).toThrow('not ready');
    expect(
      await setupResult.service.chooseExportDestination.authorize({
        projectId: accepted.projectId,
        projectionProfile: 'complete_with_history',
      }),
    ).toBe(false);
  });

  it('recusa link simbólico antes de ler a fonte', async () => {
    const root = await makeRoot();
    const targetPath = join(root, 'target.md');
    const selectedPath = join(root, 'selected.md');
    await writeFile(targetPath, await readFile(fixture('esperado.md')));
    await symlink(targetPath, selectedPath);
    const setupResult = await setup(selectedPath, join(root, 'export.md'));

    await expect(setupResult.service.selectLocal.handle({})).rejects.toThrow('Symbolic links');
  });
});
