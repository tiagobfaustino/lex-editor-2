import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow, OpenDialogOptions } from 'electron';
import type { ActiveSourceImportConfiguration } from '@lex-editor/source-ingestion';
import type { PublicationHistoryAuthority } from '@lex-editor/legal-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLocalProjectService,
  SourceConfigurationResolutionError,
  type ActiveSourceImportResolver,
} from '../../src/main/local-project-service.js';
import { createLocalAuditJournalStore } from '../../src/main/audit/local-audit-journal.js';
import { createEditorialProjectStore } from '../../src/main/projects/editorial-project-store.js';
import type { PlanaltoNetworkPorts } from '../../src/main/import/planalto-source.js';
import type { PreviewNodeDto, ProgressDto } from '../../src/shared/ipc/import.js';
import type { ReprocessingStateDto } from '../../src/shared/ipc/reprocessing.js';

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
const lawFixture = (...parts: string[]): string =>
  join(process.cwd(), 'fixtures', 'legal', ...parts);

const setup = async (
  selectedPath: string,
  destinationPath: string,
  networkPorts?: PlanaltoNetworkPorts,
  activeSourceImportResolver?: ActiveSourceImportResolver,
  publicationHistoryAuthority?: PublicationHistoryAuthority,
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
    ...(activeSourceImportResolver === undefined ? {} : { activeSourceImportResolver }),
    ...(publicationHistoryAuthority === undefined ? {} : { publicationHistoryAuthority }),
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

const readAuditEvents = async (root: string, projectId: string): Promise<unknown[]> => {
  const journal = createLocalAuditJournalStore(join(root, 'workspace'));
  const { entries } = await journal.read(projectId);
  return entries.map(({ event }) => event);
};

describe('local project service', () => {
  it('persiste metadados, invalida aprovação e usa a mesma revisão no preview e exportação', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb.md');
    const destinationPath = join(root, 'lindb-revisada.md');
    await writeFile(sourcePath, await readFile(fixture('esperado.md')));
    const publicationHistoryAuthority: PublicationHistoryAuthority = {
      inspect: () =>
        Promise.resolve({
          availability: 'available',
          authorityRevision: 'publication-db-revision-12',
          publishedVersionIds: [],
        }),
    };
    const setupResult = await setup(
      sourcePath,
      destinationPath,
      undefined,
      undefined,
      publicationHistoryAuthority,
    );
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const before = await setupResult.service.getMetadataState.handle({
      projectId: accepted.projectId,
    });
    await setupResult.service.validateEditorial.handle({ projectId: accepted.projectId });
    await setupResult.service.approveEditorial.handle({ projectId: accepted.projectId });

    const saved = await setupResult.service.updateMetadata.handle({
      projectId: accepted.projectId,
      expectedRevisionHash: before.revisionHash,
      changes: { titulo: 'Lei de Introdução revisada', ramo: 'direito público' },
      reason: 'Título e ramo conferidos na fonte oficial.',
    });
    expect(saved).toMatchObject({
      journalSequence: 1,
      publicationHistoryState: 'never_published',
      fields: { titulo: { value: 'Lei de Introdução revisada' } },
    });
    expect(saved.revisionHash).not.toBe(before.revisionHash);
    const preview = await setupResult.service.getPreviewDocument.handle({
      projectId: accepted.projectId,
    });
    const editorial = await setupResult.service.getEditorialState.handle({
      projectId: accepted.projectId,
    });
    expect(preview).toMatchObject({
      revisionHash: saved.revisionHash,
      title: 'Lei de Introdução revisada',
    });
    expect(editorial).toMatchObject({
      revisionHash: saved.revisionHash,
      reviewApprovalStatus: 'invalidated',
      validationIsComplete: false,
      canExport: false,
    });

    const journalPath = join(
      setupResult.root,
      'workspace',
      'editorial-projects',
      accepted.projectId,
      'journal.json',
    );
    const persisted = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('metadataWorkspace');
    expect(JSON.stringify(persisted)).not.toContain(destinationPath);
    expect(persisted).toMatchObject({
      entries: [
        {
          command: {
            localActorId: 'editor-local',
            operation: {
              kind: 'set_law_metadata',
              changes: { titulo: 'Lei de Introdução revisada', ramo: 'direito público' },
            },
          },
          metadataContext: {
            publicationHistoryEvidence: { state: 'never_published' },
          },
        },
      ],
    });

    await expect(
      setupResult.service.updateMetadata.handle({
        projectId: accepted.projectId,
        expectedRevisionHash: before.revisionHash,
        changes: { ramo: 'direito civil' },
        reason: 'Formulário antigo.',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await setupResult.service.validateEditorial.handle({ projectId: accepted.projectId });
    await setupResult.service.approveEditorial.handle({ projectId: accepted.projectId });
    const destination = await setupResult.service.chooseExportDestination.handle({
      projectId: accepted.projectId,
      projectionProfile: 'complete_with_history',
    });
    if (destination === null) throw new Error('Destino cancelado inesperadamente.');
    const exported = await setupResult.service.writeExport.handle({
      projectId: accepted.projectId,
      destinationId: destination.destinationId,
    });
    expect(exported.revisionHash).toBe(saved.revisionHash);
    await expect(readFile(destinationPath, 'utf8')).resolves.toContain(
      'title: "Lei de Introdução revisada"',
    );
    expect(setupResult.service.getApprovedRevision(accepted.projectId)).toMatchObject({
      revisionHash: saved.revisionHash,
      lawTitle: 'Lei de Introdução revisada',
      sigla: 'lindb',
    });
  });

  it('bloqueia identidade publicada sem alterar revisão ou Block IDs, mas permite correção editorial', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb-publicada.md');
    await writeFile(sourcePath, await readFile(fixture('esperado.md')));
    const setupResult = await setup(
      sourcePath,
      join(root, 'nao-utilizado.md'),
      undefined,
      undefined,
      {
        inspect: () =>
          Promise.resolve({
            availability: 'available',
            authorityRevision: 'publication-db-revision-published',
            publishedVersionIds: ['11111111-1111-4111-8111-111111111111'],
          }),
      },
    );
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const before = await setupResult.service.getMetadataState.handle({
      projectId: accepted.projectId,
    });
    const treeBefore = await semanticTree(setupResult.service, accepted.projectId);
    expect(before).toMatchObject({
      publicationHistoryState: 'published',
      fields: {
        sigla: { editable: false, blockedReason: 'published_identity' },
        numero: { editable: false, blockedReason: 'published_identity' },
        ramo: { editable: true, blockedReason: null },
      },
    });

    await expect(
      setupResult.service.updateMetadata.handle({
        projectId: accepted.projectId,
        expectedRevisionHash: before.revisionHash,
        changes: { sigla: 'nova' },
        reason: 'Tentativa de alterar identidade publicada.',
      }),
    ).rejects.toThrow(/published_identity_immutable/u);

    const unchanged = await setupResult.service.getMetadataState.handle({
      projectId: accepted.projectId,
    });
    expect(unchanged.revisionHash).toBe(before.revisionHash);
    expect(await semanticTree(setupResult.service, accepted.projectId)).toEqual(treeBefore);

    const edited = await setupResult.service.updateMetadata.handle({
      projectId: accepted.projectId,
      expectedRevisionHash: before.revisionHash,
      changes: { ramo: 'direito público' },
      reason: 'Correção editorial que não altera identidade.',
    });
    expect(edited).toMatchObject({
      publicationHistoryState: 'published',
      fields: {
        sigla: { value: 'lindb', editable: false, blockedReason: 'published_identity' },
        ramo: { value: 'direito público', editable: true },
      },
    });
  });

  it('funciona offline para correção comum e falha fechada somente na identidade', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb-offline.md');
    await writeFile(sourcePath, await readFile(fixture('esperado.md')));
    const setupResult = await setup(
      sourcePath,
      join(root, 'nao-utilizado.md'),
      undefined,
      undefined,
      { inspect: () => Promise.reject(new Error('offline')) },
    );
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const before = await setupResult.service.getMetadataState.handle({
      projectId: accepted.projectId,
    });
    expect(before).toMatchObject({
      publicationHistoryState: 'unknown',
      fields: {
        sigla: { editable: false, blockedReason: 'publication_history_unknown' },
        ramo: { editable: true, blockedReason: null },
      },
    });
    const edited = await setupResult.service.updateMetadata.handle({
      projectId: accepted.projectId,
      expectedRevisionHash: before.revisionHash,
      changes: { ramo: 'direito privado' },
      reason: 'Correção local disponível offline.',
    });
    expect(edited.fields.ramo.value).toBe('direito privado');

    await expect(
      setupResult.service.updateMetadata.handle({
        projectId: accepted.projectId,
        expectedRevisionHash: edited.revisionHash,
        changes: { numero: '999' },
        reason: 'Identidade não comprovada offline.',
      }),
    ).rejects.toThrow(/publication_history_required/u);
    const after = await setupResult.service.getMetadataState.handle({
      projectId: accepted.projectId,
    });
    expect(after).toMatchObject({
      revisionHash: edited.revisionHash,
      fields: { numero: { value: before.fields.numero.value }, ramo: { value: 'direito privado' } },
    });
  });

  it('não promove nem informa metadado salvo quando a escrita durável falha', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb.md');
    await writeFile(sourcePath, await readFile(fixture('esperado.md')));
    const setupResult = await setup(sourcePath, join(root, 'nao-exportado.md'));
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });
    const before = await setupResult.service.getMetadataState.handle({
      projectId: accepted.projectId,
    });
    const projectDirectory = join(
      setupResult.root,
      'workspace',
      'editorial-projects',
      accepted.projectId,
    );
    const external = join(root, 'checkpoint-fora.json');
    await writeFile(external, '{}');
    await symlink(external, join(projectDirectory, 'checkpoint.json'));

    await expect(
      setupResult.service.updateMetadata.handle({
        projectId: accepted.projectId,
        expectedRevisionHash: before.revisionHash,
        changes: { titulo: 'Título que não deve ser promovido' },
        reason: 'Teste de falha durável.',
      }),
    ).rejects.toThrow();

    const after = await setupResult.service.getMetadataState.handle({
      projectId: accepted.projectId,
    });
    const preview = await setupResult.service.getPreviewDocument.handle({
      projectId: accepted.projectId,
    });
    expect(after).toMatchObject({ revisionHash: before.revisionHash, journalSequence: 0 });
    expect(after.fields.titulo.value).toBe(before.fields.titulo.value);
    expect(preview.revisionHash).toBe(before.revisionHash);
  });

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

  it('resolve a revisão ativa, coleta somente o conjunto configurado e persiste sua identidade', async () => {
    const root = await makeRoot();
    const selectedPath = join(root, 'unused.html');
    await writeFile(selectedPath, '<html></html>');
    const requestedUrl = 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm';
    const compiledUrl = 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm';
    const configuration: ActiveSourceImportConfiguration = {
      providerRevision: {
        schemaVersion: 1,
        providerRevisionId: '11111111-1111-4111-8111-111111111111',
        providerId: '22222222-2222-4222-8222-222222222222',
        revisionNumber: 3,
        providerKey: 'planalto-oficial',
        providerName: 'Portal da Legislação do Planalto',
        sourceType: 'planalto_html',
        adapterId: 'planalto.html',
        adapterContractVersion: 1,
        origin: {
          scheme: 'https',
          host: 'www.planalto.gov.br',
          port: null,
          pathPrefix: '/ccivil_03/',
        },
        detectionParameters: { requireLegalHeader: true },
        configDigest: 'a'.repeat(64),
        createdByUserId: '33333333-3333-4333-8333-333333333333',
        createdAt: '2026-08-13T15:00:00.000Z',
      },
      bindingRevision: {
        schemaVersion: 1,
        bindingRevisionId: '44444444-4444-4444-8444-444444444444',
        bindingId: '55555555-5555-4555-8555-555555555555',
        lawId: '66666666-6666-4666-8666-666666666666',
        providerRevisionId: '11111111-1111-4111-8111-111111111111',
        revisionNumber: 4,
        artifacts: [
          {
            order: 0,
            sourceRole: 'primary_current',
            sourceVariant: 'compiled',
            sourceUrl: compiledUrl,
          },
          {
            order: 1,
            sourceRole: 'historical_auxiliary',
            sourceVariant: 'annotated',
            sourceUrl: requestedUrl,
          },
        ],
        monitoringIntervalMs: 86_400_000,
        configDigest: 'b'.repeat(64),
        createdByUserId: '33333333-3333-4333-8333-333333333333',
        createdAt: '2026-08-13T15:01:00.000Z',
      },
    };
    const requestedPaths: string[] = [];
    const ports: PlanaltoNetworkPorts = {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 }]),
      request: ({ url }) => {
        requestedPaths.push(url.pathname);
        return Promise.resolve({
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: Buffer.from(`<html>${url.pathname}</html>`),
        });
      },
    };
    const resolver = { resolve: vi.fn(() => Promise.resolve(configuration)) };
    const result = await setup(selectedPath, join(root, 'out.md'), ports, resolver);
    const source = await result.service.importFromUrl.handle({ url: requestedUrl });

    expect(resolver.resolve).toHaveBeenCalledWith(requestedUrl);
    expect(requestedPaths.sort()).toEqual([
      '/ccivil_03/leis/2003/l10.826.htm',
      '/ccivil_03/leis/2003/l10.826compilado.htm',
    ]);
    const evidencePath = join(
      result.root,
      'workspace',
      'sources',
      source.sourceId,
      'import-evidence.json',
    );
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as Record<string, unknown>;
    expect(evidence).toMatchObject({
      configuration: {
        providerId: configuration.providerRevision.providerId,
        providerRevisionId: configuration.providerRevision.providerRevisionId,
        providerConfigDigest: configuration.providerRevision.configDigest,
        bindingId: configuration.bindingRevision.bindingId,
        bindingRevisionId: configuration.bindingRevision.bindingRevisionId,
        bindingConfigDigest: configuration.bindingRevision.configDigest,
        adapterId: 'planalto.html',
        adapterContractVersion: 1,
      },
    });
    expect(JSON.stringify(evidence)).not.toMatch(/NormaAST|snapshotPath|rawHtml|htmlContent/iu);
    expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
  });

  it('falha fechado quando o catálogo não resolve uma configuração ativa', async () => {
    const root = await makeRoot();
    const selectedPath = join(root, 'unused.html');
    await writeFile(selectedPath, '<html></html>');
    const ports: PlanaltoNetworkPorts = {
      resolveHost: vi.fn(() => Promise.resolve([{ address: '1.1.1.1', family: 4 as const }])),
      request: vi.fn(() => Promise.reject(new Error('network must not be reached'))),
    };
    const result = await setup(selectedPath, join(root, 'out.md'), ports, {
      resolve: () => Promise.resolve(null),
    });

    await expect(
      result.service.importFromUrl.handle({
        url: 'https://www.planalto.gov.br/ccivil_03/leis/l9605.htm',
      }),
    ).rejects.toBeInstanceOf(SourceConfigurationResolutionError);
    expect(ports.resolveHost).not.toHaveBeenCalled();
    expect(ports.request).not.toHaveBeenCalled();
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

describe('local project service: auditoria operacional', () => {
  it('emite eventos de importação e pipeline correlacionados pelo projeto', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb.html');
    await writeFile(sourcePath, await readFile(fixture('snapshot.html')));
    const setupResult = await setup(sourcePath, join(root, 'lindb.md'));
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });

    const events = await readAuditEvents(setupResult.root, accepted.projectId);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events as Readonly<{ correlationId: string; projectId: string }>[]) {
      expect(event.correlationId).toBe(accepted.projectId);
      expect(event.projectId).toBe(accepted.projectId);
    }
    const codes = (events as Readonly<{ detail: { eventCode: string } }>[]).map(
      (event) => event.detail.eventCode,
    );
    expect(codes).toContain('import_started');
    expect(codes).toContain('import_completed');
    expect(codes).toContain('extraction_completed');
    expect(codes).toContain('parsing_completed');
    expect(codes).toContain('identification_completed');
    expect(
      codes.some((code) => code === 'validation_completed' || code === 'validation_blocked'),
    ).toBe(true);
    expect(codes.indexOf('import_started')).toBeLessThan(codes.indexOf('import_completed'));
    expect(codes.indexOf('import_completed')).toBeLessThan(codes.indexOf('extraction_completed'));

    const pipelineRunIds = new Set(
      (events as Readonly<{ detail: { stage: string }; runId: string | null }>[])
        .filter((event) => event.detail.stage !== 'import')
        .map((event) => event.runId),
    );
    expect(pipelineRunIds).toStrictEqual(new Set([accepted.jobId]));

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toMatch(/at .*\.(?:js|ts):\d+/u);
  });

  it('emite pipeline_cancelled quando o job é cancelado entre fases', async () => {
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

    const events = await readAuditEvents(setupResult.root, accepted.projectId);
    const cancelled = (
      events as Readonly<{ detail: { eventCode: string; outcome: string } }>[]
    ).find((event) => event.detail.eventCode === 'pipeline_cancelled');
    expect(cancelled?.detail.outcome).toBe('cancelled');
  });

  it('emite import_failed sem vazar mensagem bruta quando o catálogo não resolve a configuração', async () => {
    const root = await makeRoot();
    const setupResult = await setup(
      join(root, 'unused.md'),
      join(root, 'unused-export.md'),
      undefined,
      { resolve: () => Promise.resolve(null) },
    );
    await expect(
      setupResult.service.importFromUrl.handle({ url: 'https://www.planalto.gov.br/lei.html' }),
    ).rejects.toThrow(SourceConfigurationResolutionError);

    const journal = createLocalAuditJournalStore(join(setupResult.root, 'workspace'));
    const [projectId] = await journal.listProjectIds();
    if (projectId === undefined) throw new Error('Nenhum evento de auditoria foi persistido.');
    const events = await readAuditEvents(setupResult.root, projectId);
    const failed = (events as Readonly<{ detail: { eventCode: string; outcome: string } }>[]).find(
      (event) => event.detail.eventCode === 'import_failed',
    );
    expect(failed?.detail.outcome).toBe('failed');
    expect(JSON.stringify(events)).not.toMatch(/SourceConfigurationResolutionError|at .*:\d+/u);
  });
});

describe('local project service: reprocessamento', () => {
  const REPROCESSING_TERMINAL = new Set(['completed', 'conflicted', 'failed', 'cancelled']);

  const waitForReprocessingTerminal = async (
    service: ReturnType<typeof createLocalProjectService>,
    projectId: string,
  ): Promise<ReprocessingStateDto> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const state = await service.getReprocessingState.handle({ projectId });
      if (state !== null && REPROCESSING_TERMINAL.has(state.status)) return state;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Reprocessamento não terminou a tempo.');
  };

  const importFixture = async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'lindb.md');
    await writeFile(sourcePath, await readFile(fixture('esperado.md')));
    const setupResult = await setup(sourcePath, join(root, 'lindb-export.md'));
    const selected = await setupResult.service.selectLocal.handle({});
    if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
    const accepted = await setupResult.service.startProcessing.handle({
      sourceId: selected.sourceId,
    });
    await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });
    const editorial = await setupResult.service.getEditorialState.handle({
      projectId: accepted.projectId,
    });
    return {
      ...setupResult,
      projectId: accepted.projectId,
      sourceId: selected.sourceId,
      revisionHash: editorial.revisionHash,
    };
  };

  it('reprocessa from_source_snapshot sem mudança de fonte e promove atomicamente', async () => {
    const { service, root, projectId, revisionHash } = await importFixture();

    const requested = await service.requestReprocessing.handle({
      projectId,
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      plan: 'from_source_snapshot',
      expectedRevisionHash: revisionHash,
      reason: 'Conferência periódica do parser.',
      incidentId: null,
    });
    expect(requested.status).toBe('running');

    const finalState = await waitForReprocessingTerminal(service, projectId);
    expect(finalState).toMatchObject({ status: 'completed', conflictCode: null });
    expect(finalState.resultingRevisionHash).toBe(revisionHash);

    const events = await readAuditEvents(root, projectId);
    const codes = (events as Readonly<{ detail: { eventCode: string } }>[]).map(
      (event) => event.detail.eventCode,
    );
    expect(codes).toContain('reprocess_requested');
    expect(codes).toContain('reprocess_started');
    expect(codes).toContain('reprocess_completed');

    const editorialAfter = await service.getEditorialState.handle({ projectId });
    expect(editorialAfter.revisionHash).toBe(revisionHash);
  });

  it('preserva correção editorial compatível ao reprocessar a mesma fonte', async () => {
    const { service, projectId, revisionHash } = await importFixture();
    const page = await service.getPreviewPage.handle({
      projectId,
      parentPreviewNodeId: null,
      cursor: null,
      limit: 50,
    });
    const previewNodeId = page.items[0]?.previewNodeId;
    if (previewNodeId === undefined) throw new Error('Fixture sem nó de preview.');
    const corrected = await service.correctEditorialText.handle({
      projectId,
      previewNodeId,
      value: 'Texto corrigido manualmente para o teste de reprocessamento.',
      reason: 'Correção conferida na fonte oficial para o teste.',
    });
    expect(corrected.revisionHash).not.toBe(revisionHash);

    const requested = await service.requestReprocessing.handle({
      projectId,
      requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      plan: 'from_source_snapshot',
      expectedRevisionHash: corrected.revisionHash,
      reason: 'Nova versão do parser.',
      incidentId: null,
    });
    expect(requested.status).toBe('running');
    const finalState = await waitForReprocessingTerminal(service, projectId);
    expect(finalState.status).toBe('completed');
    expect(finalState.resultingRevisionHash).toBe(corrected.revisionHash);

    const editorialAfter = await service.getEditorialState.handle({ projectId });
    expect(editorialAfter.revisionHash).toBe(corrected.revisionHash);
  });

  it('recalcula somente derivados no plano from_identified_revision sem alterar o hash normativo', async () => {
    const { service, root, projectId, revisionHash } = await importFixture();
    const journalPath = join(root, 'workspace', 'editorial-projects', projectId, 'journal.json');
    const journalBefore = await readFile(journalPath, 'utf8');

    const requested = await service.requestReprocessing.handle({
      projectId,
      requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      plan: 'from_identified_revision',
      expectedRevisionHash: revisionHash,
      reason: 'Formatter atualizado; recalcular Markdown e validação.',
      incidentId: null,
    });
    expect(requested.status).toBe('running');
    const finalState = await waitForReprocessingTerminal(service, projectId);
    expect(finalState).toMatchObject({ status: 'completed', resultingRevisionHash: revisionHash });

    expect(await readFile(journalPath, 'utf8')).toBe(journalBefore);
    const editorialAfter = await service.getEditorialState.handle({ projectId });
    expect(editorialAfter.revisionHash).toBe(revisionHash);
  });

  it('rejeita expectedRevisionHash desatualizado sem criar candidata', async () => {
    const { service, projectId } = await importFixture();

    await expect(
      service.requestReprocessing.handle({
        projectId,
        requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        plan: 'from_source_snapshot',
        expectedRevisionHash: 'f'.repeat(64),
        reason: 'Tentativa com revisão desatualizada.',
        incidentId: null,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(service.getReprocessingState.handle({ projectId })).resolves.toBeNull();
  });

  it('falha e preserva a revisão corrente quando o snapshot foi alterado no disco', async () => {
    const { service, root, projectId, sourceId, revisionHash } = await importFixture();
    const journalPath = join(root, 'workspace', 'editorial-projects', projectId, 'journal.json');
    const journalBefore = await readFile(journalPath, 'utf8');
    const sourceDirectory = join(root, 'workspace', 'sources', sourceId);
    const snapshotNames = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.md'));
    for (const name of snapshotNames) {
      await writeFile(join(sourceDirectory, name), '# Texto adulterado após a importação\n');
    }

    const requested = await service.requestReprocessing.handle({
      projectId,
      requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      plan: 'from_source_snapshot',
      expectedRevisionHash: revisionHash,
      reason: 'Verificação de integridade do snapshot.',
      incidentId: null,
    });
    expect(requested.status).toBe('running');
    const finalState = await waitForReprocessingTerminal(service, projectId);
    expect(finalState).toMatchObject({
      status: 'failed',
      resultingRevisionHash: null,
      conflictCode: null,
    });

    expect(await readFile(journalPath, 'utf8')).toBe(journalBefore);
    const editorialAfter = await service.getEditorialState.handle({ projectId });
    expect(editorialAfter.revisionHash).toBe(revisionHash);
  });

  it('devolve a operação corrente em vez de iniciar uma segunda quando o lock está ocupado', async () => {
    const { service, projectId, revisionHash } = await importFixture();
    const first = await service.requestReprocessing.handle({
      projectId,
      requestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      plan: 'from_source_snapshot',
      expectedRevisionHash: revisionHash,
      reason: 'Primeira solicitação.',
      incidentId: null,
    });
    const second = await service.requestReprocessing.handle({
      projectId,
      requestId: '10101010-1010-4101-8101-101010101010',
      plan: 'from_source_snapshot',
      expectedRevisionHash: revisionHash,
      reason: 'Segunda solicitação enquanto a primeira roda.',
      incidentId: null,
    });
    expect(second.requestId).toBe(first.requestId);
    expect(second.status).toBe('running');

    await waitForReprocessingTerminal(service, projectId);
  });

  it('idempotência: retry com o mesmo requestId após conclusão não duplica a promoção nem o evento terminal', async () => {
    const { service, root, projectId, revisionHash } = await importFixture();
    const requestId = '20202020-2020-4202-8202-202020202020';
    await service.requestReprocessing.handle({
      projectId,
      requestId,
      plan: 'from_source_snapshot',
      expectedRevisionHash: revisionHash,
      reason: 'Primeira tentativa.',
      incidentId: null,
    });
    const completed = await waitForReprocessingTerminal(service, projectId);
    expect(completed.status).toBe('completed');

    const countCompletedEvents = async (): Promise<number> => {
      const events = await readAuditEvents(root, projectId);
      return (events as Readonly<{ detail: { eventCode: string } }>[]).filter(
        (event) => event.detail.eventCode === 'reprocess_completed',
      ).length;
    };
    const before = await countCompletedEvents();

    const retried = await service.requestReprocessing.handle({
      projectId,
      requestId,
      plan: 'from_source_snapshot',
      expectedRevisionHash: revisionHash,
      reason: 'Retry idempotente da mesma solicitação.',
      incidentId: null,
    });
    expect(retried).toEqual(completed);
    expect(await countCompletedEvents()).toBe(before);
  });

  it('cancela cooperativamente antes da promoção e preserva a revisão corrente', async () => {
    const { service, projectId, revisionHash } = await importFixture();
    const accepted = await service.requestReprocessing.handle({
      projectId,
      requestId: '30303030-3030-4303-8303-303030303030',
      plan: 'from_source_snapshot',
      expectedRevisionHash: revisionHash,
      reason: 'Cancelamento imediato para o teste.',
      incidentId: null,
    });
    if (accepted.jobId === null) throw new Error('jobId ausente na resposta de aceite.');
    await service.cancelJob.handle({ jobId: accepted.jobId });

    const finalState = await waitForReprocessingTerminal(service, projectId);
    expect(finalState).toMatchObject({
      status: 'cancelled',
      resultingRevisionHash: null,
      conflictCode: null,
    });

    const editorialAfter = await service.getEditorialState.handle({ projectId });
    expect(editorialAfter.revisionHash).toBe(revisionHash);
  });

  it('recupera lock órfão sem promoção como falha ao consultar após reabertura', async () => {
    const { service, root, projectId, revisionHash } = await importFixture();
    const shadowStore = createEditorialProjectStore(join(root, 'workspace'));
    await shadowStore.saveReprocessingState({
      schemaVersion: 1,
      projectId,
      requestId: '40404040-4040-4404-8404-404040404040',
      incidentId: null,
      plan: 'from_source_snapshot',
      reason: 'Simulação de crash antes da promoção.',
      expectedRevisionHash: revisionHash,
      status: 'running',
      createdAt: '2026-08-19T12:00:00.000Z',
      updatedAt: '2026-08-19T12:00:00.000Z',
      resultingRevisionHash: null,
      conflictCode: null,
    });

    const recovered = await service.getReprocessingState.handle({ projectId });
    expect(recovered).toMatchObject({ status: 'failed', resultingRevisionHash: null });

    const editorialAfter = await service.getEditorialState.handle({ projectId });
    expect(editorialAfter.revisionHash).toBe(revisionHash);
  });

  it('recupera lock órfão já promovido como completed sem repetir a gravação', async () => {
    const { service, root, projectId, revisionHash } = await importFixture();
    const journalPath = join(root, 'workspace', 'editorial-projects', projectId, 'journal.json');
    const journalBefore = await readFile(journalPath, 'utf8');
    const shadowStore = createEditorialProjectStore(join(root, 'workspace'));
    await shadowStore.saveReprocessingState({
      schemaVersion: 1,
      projectId,
      requestId: '50505050-5050-4505-8505-505050505050',
      incidentId: null,
      plan: 'from_source_snapshot',
      reason: 'Simulação de crash após a promoção.',
      expectedRevisionHash: revisionHash,
      status: 'awaiting_promotion',
      createdAt: '2026-08-19T12:00:00.000Z',
      updatedAt: '2026-08-19T12:00:00.000Z',
      resultingRevisionHash: revisionHash,
      conflictCode: null,
    });

    const recovered = await service.getReprocessingState.handle({ projectId });
    expect(recovered).toMatchObject({ status: 'completed', resultingRevisionHash: revisionHash });
    expect(await readFile(journalPath, 'utf8')).toBe(journalBefore);
  });

  describe.each([
    { law: 'l9099', sourcePath: lawFixture('l9099', 'snapshot.html') },
    { law: 'l9605', sourcePath: lawFixture('l9605', 'snapshot.html') },
    { law: 'l10826', sourcePath: lawFixture('l10826', 'compiled', 'snapshot.html') },
  ])('T013-20: reprocessamento real — $law', ({ law, sourcePath }) => {
    it(`preserva hash normativo de ${law} nos dois planos e nos dois perfis de projeção, sem mudança de fonte`, async () => {
      const root = await makeRoot();
      const destinationPath = join(root, `${law}-export.md`);
      const setupResult = await setup(sourcePath, destinationPath);
      const selected = await setupResult.service.selectLocal.handle({});
      if (selected === null) throw new Error('Seleção cancelada inesperadamente.');
      const accepted = await setupResult.service.startProcessing.handle({
        sourceId: selected.sourceId,
      });
      await expect(setupResult.terminal).resolves.toMatchObject({ jobStatus: 'completed' });
      const projectId = accepted.projectId;

      for (const projectionProfile of ['complete_with_history', 'current_only'] as const) {
        await setupResult.service.setPreviewProjectionProfile.handle({
          projectId,
          projectionProfile,
        });
        const before = await setupResult.service.getEditorialState.handle({ projectId });
        const beforeDocument = await setupResult.service.getPreviewDocument.handle({ projectId });

        for (const plan of ['from_source_snapshot', 'from_identified_revision'] as const) {
          const requestId = randomUUID();
          const requested = await setupResult.service.requestReprocessing.handle({
            projectId,
            requestId,
            plan,
            expectedRevisionHash: before.revisionHash,
            reason: `Conferência periódica (${plan}) sem mudança de fonte.`,
            incidentId: null,
          });
          expect(requested.status).toBe('running');
          const finalState = await waitForReprocessingTerminal(setupResult.service, projectId);
          expect(finalState).toMatchObject({ status: 'completed', conflictCode: null });
          expect(finalState.resultingRevisionHash).toBe(before.revisionHash);

          const after = await setupResult.service.getEditorialState.handle({ projectId });
          expect(after.revisionHash).toBe(before.revisionHash);
          const afterDocument = await setupResult.service.getPreviewDocument.handle({ projectId });
          expect(afterDocument.totalPreviewNodes).toBe(beforeDocument.totalPreviewNodes);
          expect(afterDocument.title).toBe(beforeDocument.title);
        }
      }
    });
  });
});
