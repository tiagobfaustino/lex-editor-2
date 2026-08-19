import { mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createOperationalAuditEvent } from '@lex-editor/operational-audit';

import {
  createLocalAuditJournalStore,
  LocalAuditJournalError,
} from '../../src/main/audit/local-audit-journal.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '22222222-2222-4222-8222-222222222222';
const hash = 'a'.repeat(64);
const roots: string[] = [];

const createDesktopEvent = (
  eventId: string,
  eventProjectId = projectId,
  occurredAt = '2026-08-15T12:00:00.000Z',
) =>
  createOperationalAuditEvent({
    eventId,
    occurredAt,
    correlationId: '33333333-3333-4333-8333-333333333333',
    actor: {
      actorId: '44444444-4444-4444-8444-444444444444',
      actorRole: 'administrador_tecnico',
    },
    lawId: '55555555-5555-4555-8555-555555555555',
    projectId: eventProjectId,
    runId: '66666666-6666-4666-8666-666666666666',
    incidentId: null,
    detail: {
      kind: 'pipeline',
      eventCode: 'import_started',
      stage: 'import',
      outcome: 'started',
      durationMs: null,
      processedUnits: 0,
      nodeCount: 0,
      warningCount: 0,
      errorCount: 0,
      sourceArtifactSha256: null,
      fragmentSha256: null,
      evidence: null,
    },
  });

const createPublisherEvent = () =>
  createOperationalAuditEvent({
    eventId: '77777777-7777-4777-8777-777777777777',
    occurredAt: '2026-08-15T12:00:00.000Z',
    correlationId: '33333333-3333-4333-8333-333333333333',
    actor: { actorId: null, actorRole: 'publisher_service' },
    lawId: '55555555-5555-4555-8555-555555555555',
    projectId: null,
    runId: null,
    incidentId: null,
    detail: {
      kind: 'publication',
      eventCode: 'publication_published',
      publicationId: '88888888-8888-4888-8888-888888888888',
      manifestDigest: hash,
      gitCommitSha: 'b'.repeat(40),
      failureCode: null,
    },
  });

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'lex-operational-audit-'));
  roots.push(root);
  return root;
};

const pathsFor = (root: string) => {
  const journalsRoot = join(root, 'audit-journals');
  const projectRoot = join(journalsRoot, projectId);
  return {
    journalsRoot,
    projectRoot,
    journal: join(projectRoot, 'operational-audit.jsonl'),
  };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local operational audit journal', () => {
  it('appends durably, serializes concurrent writes and reopens the complete chain', async () => {
    const root = await createRoot();
    const store = createLocalAuditJournalStore(root);
    const events = [
      createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
      createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
      createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
    ];

    const appended = await Promise.all(events.map((event) => store.append(projectId, event)));
    expect(appended.map((entry) => entry.sequence).sort()).toEqual([1, 2, 3]);

    const reopened = await createLocalAuditJournalStore(root).read(projectId);
    expect(reopened.entries).toHaveLength(3);
    expect(reopened.entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(reopened.nextSequence).toBe(4);
    expect(reopened.lastEntryHash).toBe(reopened.entries[2]?.entryHash);
  });

  it('creates private directories and a private JSONL file', async () => {
    const root = await createRoot();
    await createLocalAuditJournalStore(root).append(
      projectId,
      createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
    );
    const paths = pathsFor(root);
    expect((await stat(paths.journalsRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.projectRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.journal)).mode & 0o777).toBe(0o600);
    expect((await readFile(paths.journal)).at(-1)).toBe(0x0a);
  });

  it('detects a valid-schema alteration in the middle without rewriting bytes', async () => {
    const root = await createRoot();
    const store = createLocalAuditJournalStore(root);
    await store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'));
    await store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'));
    const path = pathsFor(root).journal;
    const tampered = (await readFile(path, 'utf8')).replace(
      '2026-08-15T12:00:00.000Z',
      '2026-08-15T12:00:01.000Z',
    );
    await writeFile(path, tampered, { mode: 0o600 });
    const before = await readFile(path);

    await expect(store.read(projectId)).rejects.toMatchObject({
      code: 'entry_hash_mismatch',
      compromisedSequence: 1,
    });
    await expect(
      store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3')),
    ).rejects.toMatchObject({ code: 'entry_hash_mismatch' });
    expect(await readFile(path)).toEqual(before);
  });

  it('detects previous-hash alteration before accepting the next entry', async () => {
    const root = await createRoot();
    const store = createLocalAuditJournalStore(root);
    await store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'));
    await store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'));
    const path = pathsFor(root).journal;
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
    const secondLine = lines[1];
    if (secondLine === undefined) throw new Error('Expected a second journal entry.');
    const second = JSON.parse(secondLine) as Record<string, unknown>;
    second['previousHash'] = '0'.repeat(64);
    lines[1] = JSON.stringify(second);
    await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 });

    await expect(store.read(projectId)).rejects.toMatchObject({
      code: 'previous_hash_mismatch',
      compromisedSequence: 2,
    });
  });

  it('detects truncation and preserves the partial final entry', async () => {
    const root = await createRoot();
    const store = createLocalAuditJournalStore(root);
    await store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'));
    const path = pathsFor(root).journal;
    const original = await readFile(path);
    const truncated = original.subarray(0, original.byteLength - 5);
    await writeFile(path, truncated, { mode: 0o600 });

    await expect(store.read(projectId)).rejects.toMatchObject({ code: 'truncated_entry' });
    await expect(
      store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')),
    ).rejects.toMatchObject({ code: 'truncated_entry' });
    expect(await readFile(path)).toEqual(truncated);
  });

  it('rejects a foreign project and a remote-authority event before persistence', async () => {
    const root = await createRoot();
    const store = createLocalAuditJournalStore(root);
    await expect(
      store.append(
        projectId,
        createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', otherProjectId),
      ),
    ).rejects.toBeInstanceOf(LocalAuditJournalError);
    await expect(store.append(projectId, createPublisherEvent())).rejects.toMatchObject({
      code: 'invalid_event',
    });
    await expect(store.read(projectId)).resolves.toMatchObject({ entries: [] });
  });

  it('rejects a journal redirected by symlink', async () => {
    const root = await createRoot();
    const store = createLocalAuditJournalStore(root);
    await store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'));
    const path = pathsFor(root).journal;
    const external = join(root, 'external.jsonl');
    await writeFile(external, '', { mode: 0o600 });
    await unlink(path);
    await symlink(external, path);

    await expect(store.read(projectId)).rejects.toMatchObject({ code: 'unsafe_storage' });
    await expect(
      store.append(projectId, createDesktopEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')),
    ).rejects.toMatchObject({ code: 'unsafe_storage' });
    expect(await readFile(external, 'utf8')).toBe('');
  });
});
