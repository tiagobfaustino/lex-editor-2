import { randomUUID } from 'node:crypto';
import { createEditorialProjectStore } from '../../src/main/projects/editorial-project-store.js';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { createLocalProjectService } from '../../src/main/local-project-service.js';
import type { ProgressDto } from '../../src/shared/ipc/import.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'lex-library-'));
  roots.push(root);
  const sourcePath = join(root, 'lei.md');
  await writeFile(
    sourcePath,
    await readFile(join(process.cwd(), 'fixtures/legal/lindb/esperado.md')),
  );
  const progress: ProgressDto[] = [];
  const ports = {
    storageRoot: join(root, 'workspace'),
    dialog: {
      showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [sourcePath] }),
      showSaveDialog: () => Promise.resolve({ canceled: true }),
    },
    getMainWindow: () => ({}) as BrowserWindow,
    sendProgress: (event: ProgressDto) => {
      progress.push(event);
    },
    now: () => new Date('2026-10-08T20:00:00Z'),
  };
  const service = createLocalProjectService(ports);
  const importLaw = async () => {
    const source = await service.selectLocal.handle({});
    if (source === null) throw new Error('Source missing');
    const job = await service.startProcessing.handle({ sourceId: source.sourceId });
    await vi.waitFor(
      () => {
        expect(
          progress.find((event) => event.jobId === job.jobId && event.jobStatus === 'completed'),
        ).toBeDefined();
      },
      { timeout: 5000 },
    );
    return { source, projectId: job.projectId };
  };
  return { root, ports, service, importLaw, sourcePath, progress };
};

it('lista repetidas, busca a revisão editada e a reabre após reinício sem reimportar', async () => {
  const { root, ports, service, importLaw } = await setup();
  const first = await importLaw();
  // Fixture de legado: antes da regra de unicidade o app admitia cópias.
  const store = createEditorialProjectStore(ports.storageRoot);
  const recovered = await store.recover(first.projectId);
  if (!recovered.ok) throw new Error('Fixture missing');
  const second = { projectId: randomUUID() };
  await store.saveJournal({
    ...recovered.journal,
    journalId: randomUUID(),
    projectId: second.projectId,
  });
  const before = await service.getMetadataState.handle({ projectId: first.projectId });
  const saved = await service.updateMetadata.handle({
    projectId: first.projectId,
    expectedRevisionHash: before.revisionHash,
    changes: { titulo: 'LINDB da biblioteca', ramo: 'civil' },
    reason: 'Título conferido.',
  });
  await service.setPreviewProjectionProfile.handle({
    projectId: first.projectId,
    projectionProfile: 'current_only',
  });
  const journalPath = join(root, 'workspace/editorial-projects', first.projectId, 'journal.json');
  const bytes = await readFile(journalPath);
  const reader = createLocalProjectService(ports);
  const page = await reader.listLocalLaws.handle({ query: '', offset: 0, limit: 1 });
  expect(page.totalItems).toBe(2);
  expect(page.items).toHaveLength(1);
  expect(page.nextOffset).toBe(1);
  const found = await reader.listLocalLaws.handle({ query: 'biblioteca', offset: 0, limit: 25 });
  expect(found.items).toHaveLength(1);
  expect(found.items[0]).toMatchObject({
    projectId: first.projectId,
    title: 'LINDB da biblioteca',
    revisionHash: saved.revisionHash,
  });
  await Promise.all([
    reader.openLocalLaw.handle({ projectId: first.projectId }),
    reader.openLocalLaw.handle({ projectId: first.projectId }),
  ]);
  await reader.openLocalLaw.handle({ projectId: first.projectId });
  expect(await reader.getPreviewDocument.handle({ projectId: first.projectId })).toMatchObject({
    title: 'LINDB da biblioteca',
    revisionHash: saved.revisionHash,
    projectionProfile: 'current_only',
  });
  expect(await reader.getEditorialState.handle({ projectId: first.projectId })).toMatchObject({
    canExport: false,
  });
  expect(await readFile(journalPath)).toEqual(bytes);
  expect(reader.getProjectAst(second.projectId)).toBeNull();
});

it('recupera importações legadas sem criar um novo diário', async () => {
  const { root, ports, importLaw } = await setup();
  const imported = await importLaw();
  await rm(join(root, 'workspace/editorial-projects', imported.projectId, 'source.json'), {
    force: true,
  });
  const reader = createLocalProjectService(ports);
  await reader.openLocalLaw.handle({ projectId: imported.projectId });
  expect(reader.getProjectAst(imported.projectId)?.sigla).toBe('lindb');
});

it('mostra diário adulterado como indisponível e nega abertura/IDs externos', async () => {
  const { root, ports, importLaw } = await setup();
  const imported = await importLaw();
  await writeFile(
    join(root, 'workspace/editorial-projects', imported.projectId, 'journal.json'),
    '{"invalid":true}',
  );
  const reader = createLocalProjectService(ports);
  const page = await reader.listLocalLaws.handle({ query: '', offset: 0, limit: 25 });
  expect(page.items[0]).toMatchObject({
    projectId: imported.projectId,
    recoveryState: 'unavailable',
  });
  await expect(reader.openLocalLaw.handle({ projectId: imported.projectId })).rejects.toMatchObject(
    { code: 'PROJECT_UNAVAILABLE' },
  );
  await expect(reader.openLocalLaw.handle({ projectId: '../outside' })).rejects.toMatchObject({
    code: 'PROJECT_UNAVAILABLE',
  });
  expect(reader.getProjectAst(imported.projectId)).toBeNull();
});

it.each(['tampered', 'symlink'])(
  'nega snapshot %s e preserva projeto válido aberto',
  async (kind) => {
    const { root, ports, importLaw, sourcePath } = await setup();
    const valid = await importLaw();
    await writeFile(
      sourcePath,
      (await readFile(sourcePath, 'utf8')).replace('ano: 1942', 'ano: 1943'),
    );
    const imported = await importLaw();
    const reader = createLocalProjectService(ports);
    await reader.openLocalLaw.handle({ projectId: valid.projectId });
    const validBefore = reader.getProjectAst(valid.projectId);
    const directory = join(root, 'workspace/sources', imported.source.sourceId);
    const { readdir } = await import('node:fs/promises');
    const snapshot = join(
      directory,
      (await readdir(directory)).find((file) => file.endsWith('.md')) ?? 'missing',
    );
    if (kind === 'tampered') await writeFile(snapshot, 'adulterado');
    else {
      await rm(snapshot);
      await symlink(join(root, 'lei.md'), snapshot);
    }
    await expect(
      reader.openLocalLaw.handle({ projectId: imported.projectId }),
    ).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' });
    expect(reader.getProjectAst(imported.projectId)).toBeNull();
    expect(reader.getProjectAst(valid.projectId)).toEqual(validBefore);
  },
);

it('reabre conjunto URL com bytes iguais e preserva papéis e snapshots separados', async () => {
  const { ports } = await setup();
  const body = Buffer.from(
    '<html><body><p>DECRETO-LEI Nº 4.657, DE 1942</p><p>Art. 1. Texto da lei.</p></body></html>',
  );
  const service = createLocalProjectService({
    ...ports,
    networkPorts: {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 as const }]),
      request: () =>
        Promise.resolve({ statusCode: 200, headers: { 'content-type': 'text/html' }, body }),
    },
  });
  const source = await service.importFromUrl.handle({
    url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
  });
  const job = await service.startProcessing.handle({ sourceId: source.sourceId });
  await vi.waitFor(() => {
    expect(service.getProjectAst(job.projectId)).not.toBeNull();
  });
  const reader = createLocalProjectService(ports);
  await reader.openLocalLaw.handle({ projectId: job.projectId });
  expect(reader.getProjectAst(job.projectId)?.fonte).toBe(
    'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
  );
  await reader.validateEditorial.handle({ projectId: job.projectId });
  await reader.approveEditorial.handle({ projectId: job.projectId });
  const publication = await reader.getPublicationSnapshot(job.projectId);
  expect(publication.snapshots).toHaveLength(2);
  expect(publication.snapshots.map((snapshot) => snapshot.sourceRole)).toEqual([
    'primary_current',
    'cross_check',
  ]);
  expect(publication.snapshots[0]?.bytes).toEqual(body);
  expect(publication.snapshots[1]?.bytes).toEqual(body);
});

it('bloqueia nova importação da mesma identidade depois de reiniciar e preserva edição', async () => {
  const { ports, service, importLaw, root } = await setup();
  const first = await importLaw();
  const metadata = await service.getMetadataState.handle({ projectId: first.projectId });
  await service.updateMetadata.handle({
    projectId: first.projectId,
    expectedRevisionHash: metadata.revisionHash,
    changes: { titulo: 'Título revisado' },
    reason: 'Conferência',
  });
  const path = join(root, 'workspace/editorial-projects', first.projectId, 'journal.json');
  const before = await readFile(path);
  const reader = createLocalProjectService(ports);
  await expect(reader.selectLocal.handle({})).rejects.toMatchObject({ code: 'LAW_ALREADY_EXISTS' });
  expect((await reader.listLocalLaws.handle({ query: '', offset: 0, limit: 25 })).totalItems).toBe(
    1,
  );
  expect(await readFile(path)).toEqual(before);
});

it('exclui da biblioteca, revoga capacidades e permite nova importação após reinício', async () => {
  const { ports, service, importLaw } = await setup();
  const first = await importLaw();
  await service.deleteLocalLaw.handle({ projectId: first.projectId });
  expect(service.getProjectAst(first.projectId)).toBeNull();
  expect(service.getPreviewDocument.authorize({ projectId: first.projectId })).toBe(false);
  const reader = createLocalProjectService(ports);
  expect((await reader.listLocalLaws.handle({ query: '', offset: 0, limit: 25 })).totalItems).toBe(
    0,
  );
  await expect(reader.openLocalLaw.handle({ projectId: first.projectId })).rejects.toMatchObject({
    code: 'PROJECT_UNAVAILABLE',
  });
  const source = await reader.selectLocal.handle({});
  expect(source).not.toBeNull();
});

it('serializa admissões concorrentes da mesma lei sem sobrescrever o diário', async () => {
  const { service, progress } = await setup();
  const selected = await Promise.all([
    service.selectLocal.handle({}),
    service.selectLocal.handle({}),
  ]);
  const jobs = await Promise.all(
    selected.map(async (source) => {
      if (source === null) throw new Error('Source missing');
      return await service.startProcessing.handle({ sourceId: source.sourceId });
    }),
  );
  await vi.waitFor(() => {
    expect(
      jobs.every((job) =>
        progress.some(
          (event) => event.jobId === job.jobId && ['completed', 'failed'].includes(event.jobStatus),
        ),
      ),
    ).toBe(true);
  });
  expect(progress.filter((event) => event.jobStatus === 'completed')).toHaveLength(1);
  expect(progress.find((event) => event.jobStatus === 'failed')?.message).toContain('já existe');
  expect((await service.listLocalLaws.handle({ query: '', offset: 0, limit: 25 })).totalItems).toBe(
    1,
  );
});

it('nega restart do mesmo source e impede escrita/recuperação após exclusão', async () => {
  const { service, importLaw, ports } = await setup();
  const imported = await importLaw();
  await expect(
    Promise.resolve().then(() =>
      service.startProcessing.handle({ sourceId: imported.source.sourceId }),
    ),
  ).rejects.toMatchObject({ code: 'LAW_ALREADY_EXISTS' });
  const store = createEditorialProjectStore(ports.storageRoot);
  const recovery = await store.recover(imported.projectId);
  if (!recovery.ok) throw new Error('Fixture missing');
  await service.deleteLocalLaw.handle({ projectId: imported.projectId });
  await expect(store.saveJournal(recovery.journal)).rejects.toThrow('excluída');
  expect(await store.recover(imported.projectId)).toMatchObject({
    ok: false,
    error: { code: 'project_not_found' },
  });
});

it('nega exclusão com traversal, ID externo ou symlink sem alterar outra lei', async () => {
  const { service, importLaw, root, ports } = await setup();
  const imported = await importLaw();
  const external = randomUUID();
  await symlink(join(root), join(ports.storageRoot, 'editorial-projects', external));
  for (const projectId of ['../outside', randomUUID(), external]) {
    await expect(service.deleteLocalLaw.handle({ projectId })).rejects.toThrow();
  }
  expect(service.getProjectAst(imported.projectId)).not.toBeNull();
  expect(await readFile(join(root, 'lei.md'))).not.toHaveLength(0);
});

it('bloqueia URL compilada e anotada pela mesma identidade jurídica', async () => {
  const { ports, progress } = await setup();
  const body = Buffer.from(
    '<html><body><p>DECRETO-LEI Nº 4.657, DE 1942</p><p>Art. 1. Texto da lei.</p></body></html>',
  );
  const options = {
    ...ports,
    networkPorts: {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 as const }]),
      request: () =>
        Promise.resolve({ statusCode: 200, headers: { 'content-type': 'text/html' }, body }),
    },
  };
  const service = createLocalProjectService(options);
  const source = await service.importFromUrl.handle({
    url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
  });
  const job = await service.startProcessing.handle({ sourceId: source.sourceId });
  await vi.waitFor(() => {
    expect(
      progress.some((event) => event.jobId === job.jobId && event.jobStatus === 'completed'),
    ).toBe(true);
  });
  const reader = createLocalProjectService(options);
  await expect(
    reader.importFromUrl.handle({
      url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657compilado.htm',
    }),
  ).rejects.toMatchObject({ code: 'LAW_ALREADY_EXISTS' });
});

it('normaliza número e ignora título sem confundir anos diferentes', async () => {
  const { service, sourcePath, importLaw } = await setup();
  const first = await importLaw();
  const markdown = await readFile(sourcePath, 'utf8');
  await writeFile(
    sourcePath,
    markdown
      .replace('numero: "4.657"', 'numero: "4657"')
      .replace(/title: .*\n/u, 'title: "Outro título"\n'),
  );
  await expect(service.selectLocal.handle({})).rejects.toMatchObject({
    code: 'LAW_ALREADY_EXISTS',
  });
  await writeFile(sourcePath, markdown.replace('ano: 1942', 'ano: 1943'));
  const second = await importLaw();
  const before = service.getProjectAst(second.projectId);
  await service.deleteLocalLaw.handle({ projectId: first.projectId });
  expect(service.getProjectAst(second.projectId)).toEqual(before);
  const rows = await service.listLocalLaws.handle({ query: '', offset: 0, limit: 25 });
  expect(rows.items.map((row) => row.projectId)).toEqual([second.projectId]);
});

it('abertura concorrente com exclusão não ressuscita a lei', async () => {
  const { ports, importLaw } = await setup();
  const imported = await importLaw();
  const reader = createLocalProjectService(ports);
  await Promise.allSettled([
    reader.openLocalLaw.handle({ projectId: imported.projectId }),
    reader.deleteLocalLaw.handle({ projectId: imported.projectId }),
  ]);
  expect(reader.getProjectAst(imported.projectId)).toBeNull();
  expect((await reader.listLocalLaws.handle({ query: '', offset: 0, limit: 25 })).totalItems).toBe(
    0,
  );
});
