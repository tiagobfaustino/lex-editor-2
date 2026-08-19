import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendEditorialJournalEntry,
  applyEditorialCommand,
  calculateRevisionHash,
  createEditorialCheckpoint,
  identifiedMinima,
  legalNormIdentityKey,
  publicationHistoryEvidenceSchema,
  type EditorialCommand,
  type EditorialJournal,
} from '@lex-editor/legal-domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorialProjectStore } from '../../src/main/projects/editorial-project-store.js';

const roots: string[] = [];
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const JOURNAL_ID = '33333333-3333-4333-8333-333333333333';
const CHECKPOINT_ID = '55555555-5555-4555-8555-555555555555';
const COMMAND_ID_1 = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID_2 = '22222222-2222-4222-8222-222222222222';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'lex-editorial-store-'));
  roots.push(root);
  return root;
};

const makeHistory = () => {
  const ast = clone(identifiedMinima);
  const baseRevisionHash = calculateRevisionHash(ast, sha256);
  let journal: EditorialJournal = {
    schemaVersion: 1,
    journalId: JOURNAL_ID,
    projectId: PROJECT_ID,
    createdAt: '2026-08-10T12:00:00.000-03:00',
    base: { revisionHash: baseRevisionHash, ast },
    entries: [],
  };
  const firstCommand: EditorialCommand = {
    schemaVersion: 1,
    commandId: COMMAND_ID_1,
    localActorId: 'editor-local-01',
    occurredAt: '2026-08-10T12:01:00.000-03:00',
    expectedRevisionHash: baseRevisionHash,
    operation: {
      kind: 'replace_node_text',
      targetNodeId: 'no-art-1',
      field: 'caput',
      value: 'Art. 1º Texto recuperado do diário.',
      reason: 'Correção conferida na fonte oficial.',
    },
  };
  const first = applyEditorialCommand(ast, firstCommand, sha256);
  if (!first.ok) throw new Error('Primeiro comando da fixture rejeitado.');
  journal = appendEditorialJournalEntry(journal, firstCommand, first.revisionHash, sha256);
  const checkpoint = createEditorialCheckpoint(
    journal,
    first.ast,
    CHECKPOINT_ID,
    '2026-08-10T12:01:30.000-03:00',
    sha256,
  );
  const secondCommand: EditorialCommand = {
    schemaVersion: 1,
    commandId: COMMAND_ID_2,
    localActorId: 'editor-local-01',
    occurredAt: '2026-08-10T12:02:00.000-03:00',
    expectedRevisionHash: first.revisionHash,
    operation: {
      kind: 'set_law_metadata',
      changes: { titulo: 'Lei recuperada após reinício' },
      reason: 'Título conferido na publicação oficial.',
    },
  };
  const second = applyEditorialCommand(first.ast, secondCommand, sha256);
  if (!second.ok) throw new Error('Segundo comando da fixture rejeitado.');
  journal = appendEditorialJournalEntry(journal, secondCommand, second.revisionHash, sha256);
  return { journal, checkpoint, expected: second };
};

const projectDirectory = (storageRoot: string): string =>
  join(storageRoot, 'editorial-projects', PROJECT_ID);

describe('editorial project store', () => {
  it('recupera a última revisão após reinício usando checkpoint e replay restante', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'workspace');
    const history = makeHistory();
    const writer = createEditorialProjectStore(storageRoot);
    await writer.saveJournal(history.journal);
    await writer.saveCheckpoint(PROJECT_ID, history.checkpoint);

    const readerAfterRestart = createEditorialProjectStore(storageRoot);
    const recovered = await readerAfterRestart.recover(PROJECT_ID);

    expect(recovered).toMatchObject({
      ok: true,
      revisionHash: history.expected.revisionHash,
      checkpointUsed: true,
      checkpointIssue: null,
      replayedEntries: 1,
    });
    expect(recovered.ok ? recovered.ast.titulo : '').toBe('Lei recuperada após reinício');
    expect(
      recovered.ok && recovered.ast.children[0]?.tipo === 'artigo'
        ? recovered.ast.children[0].caput
        : '',
    ).toBe('Art. 1º Texto recuperado do diário.');

    const journalPath = join(projectDirectory(storageRoot), 'journal.json');
    expect((await stat(journalPath)).mode & 0o777).toBe(0o600);
    expect(
      (await readdir(projectDirectory(storageRoot))).some((name) => name.endsWith('.tmp')),
    ).toBe(false);
    expect(recovered).not.toHaveProperty('approval');
  });

  it('ignora escrita temporária interrompida e reabre somente o último diário confirmado', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'workspace');
    const history = makeHistory();
    const writer = createEditorialProjectStore(storageRoot);
    await writer.saveJournal(history.journal);
    await writeFile(
      join(projectDirectory(storageRoot), '.crash-interrompido.tmp'),
      '{"schemaVersion":1',
      { mode: 0o600 },
    );

    const readerAfterCrash = createEditorialProjectStore(storageRoot);
    const recovered = await readerAfterCrash.recover(PROJECT_ID);

    expect(recovered).toMatchObject({
      ok: true,
      revisionHash: history.expected.revisionHash,
      checkpointUsed: false,
      checkpointIssue: 'missing_checkpoint',
      replayedEntries: 2,
    });
    expect(recovered).not.toHaveProperty('approval');
  });

  it('substitui o diário atomicamente e mantém a versão anterior até a nova estar completa', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'workspace');
    const history = makeHistory();
    const store = createEditorialProjectStore(storageRoot);
    const oneEntry = { ...history.journal, entries: history.journal.entries.slice(0, 1) };
    await store.saveJournal(oneEntry);
    await store.saveJournal(history.journal);

    const persisted = JSON.parse(
      await readFile(join(projectDirectory(storageRoot), 'journal.json'), 'utf8'),
    ) as EditorialJournal;
    expect(persisted.entries).toHaveLength(2);
    await expect(store.recover(PROJECT_ID)).resolves.toMatchObject({
      ok: true,
      replayedEntries: 2,
    });
  });

  it('persiste a preferência de projeção fora do diário e a recupera após reinício', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'workspace');
    const history = makeHistory();
    const writer = createEditorialProjectStore(storageRoot);
    await writer.saveJournal(history.journal);
    const journalPath = join(projectDirectory(storageRoot), 'journal.json');
    const journalBefore = await readFile(journalPath, 'utf8');

    await expect(writer.saveProjectionPreference(PROJECT_ID, 'current_only')).resolves.toBe(
      'current_only',
    );
    expect(await readFile(journalPath, 'utf8')).toBe(journalBefore);

    const preferencePath = join(projectDirectory(storageRoot), 'projection-preference.json');
    expect((await stat(preferencePath)).mode & 0o777).toBe(0o600);
    const readerAfterRestart = createEditorialProjectStore(storageRoot);
    await expect(readerAfterRestart.loadProjectionPreference(PROJECT_ID)).resolves.toBe(
      'current_only',
    );
    await expect(readerAfterRestart.recover(PROJECT_ID)).resolves.toMatchObject({
      ok: true,
      revisionHash: history.expected.revisionHash,
      replayedEntries: 2,
    });
  });

  it('ignora checkpoint corrompido e recupera a partir do snapshot-base', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'workspace');
    const history = makeHistory();
    const store = createEditorialProjectStore(storageRoot);
    await store.saveJournal(history.journal);
    await store.saveCheckpoint(PROJECT_ID, history.checkpoint);
    await writeFile(join(projectDirectory(storageRoot), 'checkpoint.json'), '{interrompido');

    await expect(store.recover(PROJECT_ID)).resolves.toMatchObject({
      ok: true,
      revisionHash: history.expected.revisionHash,
      checkpointUsed: false,
      checkpointIssue: 'corrupt_checkpoint',
      replayedEntries: 2,
    });
  });

  it('reexecuta mudança de identidade com a prova persistida mesmo sem checkpoint utilizável', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'workspace');
    const ast = clone(identifiedMinima);
    const baseRevisionHash = calculateRevisionHash(ast, sha256);
    const evidence = publicationHistoryEvidenceSchema.parse({
      schemaVersion: 1,
      canonicalIdentityKey: legalNormIdentityKey(ast),
      state: 'never_published',
      authorityRevision: 'publication-db-revision-20',
    });
    const command: EditorialCommand = {
      schemaVersion: 1,
      commandId: COMMAND_ID_1,
      localActorId: 'editor-local',
      occurredAt: '2026-08-14T12:00:00.000Z',
      expectedRevisionHash: baseRevisionHash,
      operation: {
        kind: 'set_law_metadata',
        changes: { sigla: 'nova', numero: '2' },
        reason: 'Identidade conferida antes da primeira publicação.',
      },
    };
    const applied = applyEditorialCommand(ast, command, sha256, {
      publicationHistoryEvidence: evidence,
      metadataWorkspace: {
        currentDocumentId: PROJECT_ID,
        documents: [{ documentId: PROJECT_ID, ast }],
      },
    });
    if (!applied.ok) throw new Error('Mudança de identidade da fixture rejeitada.');
    const journal = appendEditorialJournalEntry(
      {
        schemaVersion: 1,
        journalId: JOURNAL_ID,
        projectId: PROJECT_ID,
        createdAt: '2026-08-14T12:00:00.000Z',
        base: { revisionHash: baseRevisionHash, ast },
        entries: [],
      },
      command,
      applied.revisionHash,
      sha256,
      { publicationHistoryEvidence: evidence },
    );
    const store = createEditorialProjectStore(storageRoot);
    await store.saveJournal(journal);
    await writeFile(join(projectDirectory(storageRoot), 'checkpoint.json'), '{corrompido');

    const recovered = await store.recover(PROJECT_ID);

    expect(recovered).toMatchObject({
      ok: true,
      revisionHash: applied.revisionHash,
      checkpointUsed: false,
      checkpointIssue: 'corrupt_checkpoint',
      replayedEntries: 1,
      ast: { sigla: 'nova', numero: '2' },
    });
  });

  it('não abre silenciosamente diário truncado ou resultado adulterado', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'workspace');
    const history = makeHistory();
    const store = createEditorialProjectStore(storageRoot);
    await store.saveJournal(history.journal);
    const journalPath = join(projectDirectory(storageRoot), 'journal.json');
    await writeFile(journalPath, '{"schemaVersion":1');
    await expect(store.recover(PROJECT_ID)).resolves.toMatchObject({
      ok: false,
      error: { code: 'journal_corrupt' },
    });

    await store.saveJournal(history.journal);
    const tampered = clone(history.journal);
    const last = tampered.entries.at(-1);
    if (last === undefined) throw new Error('Fixture sem entrada final.');
    last.resultRevisionHash = 'f'.repeat(64);
    await writeFile(journalPath, JSON.stringify(tampered));
    await expect(store.recover(PROJECT_ID)).resolves.toMatchObject({
      ok: false,
      error: { code: 'replay_failed' },
    });
  });

  it('recusa identificador inválido e artefato redirecionado por symlink', async () => {
    const root = await makeRoot();
    const storageRoot = join(root, 'workspace');
    const history = makeHistory();
    const store = createEditorialProjectStore(storageRoot);
    await store.saveJournal(history.journal);
    await expect(store.recover('../fora')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_project_id' },
    });

    const external = join(root, 'externo.json');
    const journalPath = join(projectDirectory(storageRoot), 'journal.json');
    await writeFile(external, JSON.stringify(history.journal));
    await rm(journalPath);
    await symlink(external, journalPath);
    await expect(store.recover(PROJECT_ID)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsafe_storage' },
    });
  });

  describe('estado de reprocessamento (lock e idempotência)', () => {
    const REQUEST_ID = '77777777-7777-4777-8777-777777777777';

    const reprocessingFixture = (
      overrides: Partial<{
        status:
          'running' | 'awaiting_promotion' | 'completed' | 'conflicted' | 'failed' | 'cancelled';
        resultingRevisionHash: string | null;
        conflictCode: string | null;
      }> = {},
    ) => ({
      schemaVersion: 1 as const,
      projectId: PROJECT_ID,
      requestId: REQUEST_ID,
      incidentId: null,
      plan: 'from_source_snapshot' as const,
      reason: 'Nova versão do parser oficial.',
      expectedRevisionHash: 'a'.repeat(64),
      status: overrides.status ?? ('running' as const),
      createdAt: '2026-08-19T12:00:00.000Z',
      updatedAt: '2026-08-19T12:00:00.000Z',
      resultingRevisionHash: overrides.resultingRevisionHash ?? null,
      conflictCode: overrides.conflictCode ?? null,
    });

    it('grava e recupera o lock de reprocessamento sem tocar no diário', async () => {
      const root = await makeRoot();
      const storageRoot = join(root, 'workspace');
      const history = makeHistory();
      const store = createEditorialProjectStore(storageRoot);
      await store.saveJournal(history.journal);
      const journalPath = join(projectDirectory(storageRoot), 'journal.json');
      const journalBefore = await readFile(journalPath, 'utf8');

      const saved = await store.saveReprocessingState(reprocessingFixture());
      expect(saved.status).toBe('running');
      expect(await readFile(journalPath, 'utf8')).toBe(journalBefore);

      const statePath = join(projectDirectory(storageRoot), 'reprocessing.json');
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
      expect(
        (await readdir(projectDirectory(storageRoot))).some((name) => name.endsWith('.tmp')),
      ).toBe(false);

      const readerAfterRestart = createEditorialProjectStore(storageRoot);
      await expect(readerAfterRestart.loadReprocessingState(PROJECT_ID)).resolves.toEqual(saved);
    });

    it('devolve null quando nenhuma solicitação de reprocessamento existe', async () => {
      const root = await makeRoot();
      const storageRoot = join(root, 'workspace');
      const history = makeHistory();
      const store = createEditorialProjectStore(storageRoot);
      await store.saveJournal(history.journal);

      await expect(store.loadReprocessingState(PROJECT_ID)).resolves.toBeNull();
    });

    it('sobrescreve o lock atomicamente quando o status avança', async () => {
      const root = await makeRoot();
      const storageRoot = join(root, 'workspace');
      const history = makeHistory();
      const store = createEditorialProjectStore(storageRoot);
      await store.saveJournal(history.journal);
      await store.saveReprocessingState(reprocessingFixture({ status: 'running' }));

      const completed = await store.saveReprocessingState(
        reprocessingFixture({ status: 'completed', resultingRevisionHash: 'b'.repeat(64) }),
      );

      await expect(store.loadReprocessingState(PROJECT_ID)).resolves.toEqual(completed);
      expect(
        (await readdir(projectDirectory(storageRoot))).some((name) => name.endsWith('.tmp')),
      ).toBe(false);
    });
  });
});
