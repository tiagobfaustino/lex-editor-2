import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow } from 'electron';
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

    const destination = await setupResult.service.chooseExportDestination.handle({
      projectId: accepted.projectId,
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
