import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { createLocalProjectService } from '../../src/main/local-project-service.js';
import { createEditorialProjectStore } from '../../src/main/projects/editorial-project-store.js';
import { formatar, replayEditorialJournal } from '@lex-editor/legal-domain';
import { createHash } from 'node:crypto';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const url = 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm';
const html = (text: string, extra = '', number = '4.657') =>
  Buffer.from(
    `<html><head><meta charset="windows-1252"></head><body><p>DECRETO-LEI Nº ${number}, DE 1942</p><p>Art. 1. ${text}</p>${extra}</body></html>`,
    'latin1',
  );
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'lex-source-update-'));
  roots.push(root);
  let body: Buffer = html('Redação original.');
  let beforeRequest: (() => Promise<void>) | undefined;
  const ports = {
    storageRoot: join(root, 'workspace'),
    getMainWindow: () => ({}) as BrowserWindow,
    dialog: {
      showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [join(root, 'export')] }),
      showSaveDialog: () => Promise.resolve({ canceled: true }),
    },
    sendProgress: () => undefined,
    now: () => new Date('2026-10-08T20:00:00Z'),
    networkPorts: {
      resolveHost: () => Promise.resolve([{ address: '1.1.1.1', family: 4 as const }]),
      request: async () => {
        await beforeRequest?.();
        return { statusCode: 200, headers: { 'content-type': 'text/html' }, body };
      },
    },
  };
  await mkdir(join(root, 'export'));
  const service = createLocalProjectService(ports);
  const source = await service.importFromUrl.handle({ url });
  const job = await service.startProcessing.handle({ sourceId: source.sourceId });
  await vi.waitFor(() => {
    expect(service.getProjectAst(job.projectId)).not.toBeNull();
  });
  const projectId = job.projectId;
  const journalPath = join(ports.storageRoot, 'editorial-projects', projectId, 'journal.json');
  const apply = async (
    check: Awaited<ReturnType<typeof service.checkLocalSource.handle>>,
    overwriteConflicts = false,
  ) =>
    service.applyLocalSourceUpdate.handle({
      projectId,
      checkId: check.checkId,
      expectedRevisionHash: check.expectedRevisionHash,
      acknowledged: true,
      overwriteConflicts,
      reason: 'Fonte conferida manualmente.',
    });
  return {
    root,
    ports,
    service,
    projectId,
    journalPath,
    apply,
    setBody: (next: Buffer) => {
      body = next;
    },
    setRequest: (fn: () => Promise<void>) => {
      beforeRequest = fn;
    },
  };
};
it('confere sem alterar diário, aplica preservando IDs, recupera e exporta lei integral e relatório', async () => {
  const f = await setup();
  const initial = f.service.getProjectAst(f.projectId);
  if (initial === null) throw new Error('Missing fixture');
  const metadata = await f.service.getMetadataState.handle({ projectId: f.projectId });
  await f.service.updateMetadata.handle({
    projectId: f.projectId,
    expectedRevisionHash: metadata.revisionHash,
    changes: { titulo: 'Lei revisada' },
    reason: 'Título editorial',
  });
  const journal = await readFile(f.journalPath);
  f.setBody(html('Redação atualizada.', '<p>§ 1. Novo parágrafo.</p>'));
  const check = await f.service.checkLocalSource.handle({ projectId: f.projectId });
  expect(check).toMatchObject({ hasChanges: true, canApply: true, sourceUrl: url });
  expect(check.entries.some((entry) => entry.category === 'amended')).toBe(true);
  expect(await readFile(f.journalPath)).toEqual(journal);
  await f.apply(check);
  expect(f.service.getProjectAst(f.projectId)).toMatchObject({
    titulo: 'Lei revisada',
    children: [
      {
        blockId: initial.children[0]?.blockId,
        caput: 'Redação atualizada.',
        redacoesAnteriores: [{ texto: 'Redação original.' }],
      },
    ],
  });
  const store = createEditorialProjectStore(f.ports.storageRoot);
  const recovered = await store.recover(f.projectId);
  expect(recovered.ok).toBe(true);
  if (!recovered.ok) throw new Error('Recovery failed');
  expect(recovered.journal.entries.map((entry) => entry.command.operation.kind)).toEqual([
    'set_law_metadata',
    'apply_source_update',
  ]);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  expect(replayEditorialJournal(recovered.journal, hash)).toMatchObject({
    ok: true,
    ast: recovered.ast,
  });
  const reader = createLocalProjectService(f.ports);
  await reader.openLocalLaw.handle({ projectId: f.projectId });
  expect(reader.getProjectAst(f.projectId)).toEqual(recovered.ast);
  expect(await reader.checkLocalSource.handle({ projectId: f.projectId })).toMatchObject({
    hasChanges: false,
    entries: [],
  });
  expect(await reader.getEditorialState.handle({ projectId: f.projectId })).toMatchObject({
    canExport: false,
  });
  await reader.validateEditorial.handle({ projectId: f.projectId });
  const approval = await reader.approveEditorial.handle({ projectId: f.projectId });
  expect(approval.canExport).toBe(true);
  const snapshot = await reader.getPublicationSnapshot(f.projectId);
  expect(snapshot.snapshots.some((item) => item.sourceRole === 'historical_auxiliary')).toBe(true);
  const destination = await reader.chooseBatchExportDestination.handle({
    projectIds: [f.projectId],
  });
  if (destination === null) throw new Error('Destination missing');
  const result = await reader.writeBatchExport.handle({ destinationId: destination.destinationId });
  const exported = result.results[0];
  expect(exported).toMatchObject({
    batchExportStatus: 'succeeded',
    changeReportFileName: 'ALTERACOES.md',
  });
  if (exported?.batchExportStatus !== 'succeeded') throw new Error('Export failed');
  const dir = join(f.root, 'export', 'leis', exported.directoryName);
  expect(await readdir(dir)).toEqual(
    expect.arrayContaining(['UPDATE.md', 'ALTERACOES.md', exported.markdownFileName]),
  );
  const report = await readFile(join(dir, 'ALTERACOES.md'), 'utf8');
  expect(report).toContain('Redação original.');
  expect(report).toContain('Redação atualizada.');
  expect(report).toContain('Novo parágrafo.');
  expect(report).toContain(recovered.revisionHash);
  expect(report).toContain(initial.children[0]?.blockId ?? 'missing');
  const law = await readFile(join(dir, exported.markdownFileName), 'utf8');
  expect(law).toContain('Redação atualizada.');
  expect(law).toContain('Redação original.');
});
it('bloqueia proposta obsoleta ou adulterada e outra identidade sem perder revisão', async () => {
  const f = await setup();
  f.setBody(html('Redação atualizada.'));
  const check = await f.service.checkLocalSource.handle({ projectId: f.projectId });
  const path = join(
    f.ports.storageRoot,
    'editorial-projects',
    f.projectId,
    `source-check-${check.checkId}.json`,
  );
  const raw = JSON.parse(await readFile(path, 'utf8')) as { checkedAt: string };
  raw.checkedAt = '2026-10-09T20:00:00Z';
  await writeFile(path, JSON.stringify(raw));
  await expect(f.apply(check)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  const fresh = await f.service.checkLocalSource.handle({ projectId: f.projectId });
  const before = await f.service.getMetadataState.handle({ projectId: f.projectId });
  await f.service.updateMetadata.handle({
    projectId: f.projectId,
    expectedRevisionHash: before.revisionHash,
    changes: { titulo: 'Outra edição' },
    reason: 'Edição após conferência',
  });
  await expect(f.apply(fresh)).rejects.toMatchObject({ code: 'CONFLICT' });
  const bytes = await readFile(f.journalPath);
  f.setBody(html('Lei diferente.', '', '9.999'));
  await expect(f.service.checkLocalSource.handle({ projectId: f.projectId })).rejects.toThrow(
    'SOURCE_IDENTITY_MISMATCH',
  );
  expect(await readFile(f.journalPath)).toEqual(bytes);
});
it('conflito exige consentimento separado e a correção permanece no histórico', async () => {
  const f = await setup();
  const page = await f.service.getPreviewPage.handle({
    projectId: f.projectId,
    parentPreviewNodeId: null,
    cursor: null,
    limit: 25,
  });
  const target = page.items[0];
  if (target === undefined) throw new Error('Missing node');
  await f.service.correctEditorialText.handle({
    projectId: f.projectId,
    previewNodeId: target.previewNodeId,
    value: 'Correção local.',
    reason: 'Ajuste local',
  });
  f.setBody(html('Redação oficial nova.'));
  const check = await f.service.checkLocalSource.handle({ projectId: f.projectId });
  expect(check.conflictingBlockIds).toHaveLength(1);
  const journal = await readFile(f.journalPath);
  await expect(f.apply(check)).rejects.toThrow();
  expect(await readFile(f.journalPath)).toEqual(journal);
  await f.apply(check, true);
  expect(f.service.getProjectAst(f.projectId)?.children[0]).toMatchObject({
    caput: 'Redação oficial nova.',
    redacoesAnteriores: expect.arrayContaining([
      { texto: 'Correção local.', nota: expect.any(String) as unknown },
    ]) as unknown,
  });
});
it('falha de rede, edição concorrente e exclusão não adotam fonte parcialmente', async () => {
  const f = await setup();
  const bytes = await readFile(f.journalPath);
  f.setRequest(() => Promise.reject(new Error('offline')));
  await expect(f.service.checkLocalSource.handle({ projectId: f.projectId })).rejects.toThrow();
  expect(await readFile(f.journalPath)).toEqual(bytes);
  let release!: () => void;
  let started!: () => void;
  const signal = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.setRequest(async () => {
    started();
    await gate;
  });
  f.setBody(html('Nova redação.'));
  const checking = f.service.checkLocalSource.handle({ projectId: f.projectId });
  await signal;
  const before = await f.service.getMetadataState.handle({ projectId: f.projectId });
  await f.service.updateMetadata.handle({
    projectId: f.projectId,
    expectedRevisionHash: before.revisionHash,
    changes: { titulo: 'Editada durante consulta' },
    reason: 'Edição concorrente',
  });
  release();
  await expect(checking).rejects.toMatchObject({ code: 'CONFLICT' });
  f.setRequest(() => Promise.resolve());
  const next = await f.service.checkLocalSource.handle({ projectId: f.projectId });
  await f.service.deleteLocalLaw.handle({ projectId: f.projectId });
  await expect(f.apply(next)).rejects.toThrow();
  expect(await createEditorialProjectStore(f.ports.storageRoot).recover(f.projectId)).toMatchObject(
    { ok: false, error: { code: 'project_not_found' } },
  );
  expect(
    f.service.applyLocalSourceUpdate.authorize({
      projectId: f.projectId,
      checkId: randomUUID(),
      expectedRevisionHash: next.expectedRevisionHash,
      acknowledged: true,
      overwriteConflicts: false,
      reason: 'Teste',
    }),
  ).toBe(false);
});

it('confere Markdown local pela URL dos metadados e recupera snapshots mistos', async () => {
  const f = await setup();
  const original = f.service.getProjectAst(f.projectId);
  const markdown = formatar(original);
  if (!markdown.ok) throw new Error('Fixture failed');
  const file = join(f.root, 'lei-local.md');
  await writeFile(file, markdown.valor);
  const ports = {
    ...f.ports,
    storageRoot: join(f.root, 'local-workspace'),
    dialog: {
      ...f.ports.dialog,
      showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [file] }),
    },
  };
  const service = createLocalProjectService(ports);
  const selected = await service.selectLocal.handle({});
  if (selected === null) throw new Error('Fixture failed');
  const job = await service.startProcessing.handle({ sourceId: selected.sourceId });
  await vi.waitFor(() => {
    expect(service.getProjectAst(job.projectId)).not.toBeNull();
  });
  f.setBody(html('Atualização da lei local.'));
  const check = await service.checkLocalSource.handle({ projectId: job.projectId });
  expect(check.sourceUrl).toBe(url);
  await service.applyLocalSourceUpdate.handle({
    projectId: job.projectId,
    checkId: check.checkId,
    expectedRevisionHash: check.expectedRevisionHash,
    acknowledged: true,
    overwriteConflicts: false,
    reason: 'Conferência da URL do Markdown',
  });
  const reader = createLocalProjectService(ports);
  await reader.openLocalLaw.handle({ projectId: job.projectId });
  expect(reader.getProjectAst(job.projectId)?.children[0]).toMatchObject({
    caput: 'Atualização da lei local.',
  });
  await reader.validateEditorial.handle({ projectId: job.projectId });
  await reader.approveEditorial.handle({ projectId: job.projectId });
  const snapshot = await reader.getPublicationSnapshot(job.projectId);
  expect(snapshot.snapshots.map((item) => item.sourceType)).toEqual(
    expect.arrayContaining(['markdown', 'planalto_html']),
  );
});

it('duas aplicações simultâneas adotam uma única revisão', async () => {
  const f = await setup();
  f.setBody(html('Alteração concorrente.'));
  const check = await f.service.checkLocalSource.handle({ projectId: f.projectId });
  const results = await Promise.allSettled([f.apply(check), f.apply(check)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const recovery = await createEditorialProjectStore(f.ports.storageRoot).recover(f.projectId);
  if (!recovery.ok) throw new Error('Recovery failed');
  expect(recovery.journal.entries).toHaveLength(1);
});
