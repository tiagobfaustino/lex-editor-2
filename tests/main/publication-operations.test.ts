import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { calculateRevisionHash, identifiedMinima } from '@lex-editor/legal-domain';
import { createPublicationOperations } from '../../src/main/publication/operations.js';
import type {
  PublicationAttemptDto,
  PublicationHistoryItemDto,
} from '../../src/shared/ipc/publication.js';
import { parseCanonicalPublicationManifest } from '../../src/main/publication/manifest.js';
import type { z } from 'zod';
import { PublicationContextSchema } from '../../services/desktop-gateway/src/contracts.js';
import { createPublicationDesktopCapabilities } from '../../src/main/publication/desktop-service.js';

const exec = promisify(execFile);
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const USER = '44444444-4444-4444-8444-444444444444';
const LAW = '33333333-3333-4333-8333-333333333333';
const PROJECT = '11111111-1111-4111-8111-111111111111';

async function setup(sourceOverride?: Buffer) {
  const root = await mkdtemp(join(tmpdir(), 'lex-desktop-publication-'));
  roots.push(root);
  const repositoryRoot = join(root, 'repository');
  const origin = join(root, 'origin.git');
  await exec('git', ['init', '--bare', origin]);
  await exec('git', ['init', '--initial-branch=main', repositoryRoot]);
  await exec('git', ['config', 'user.name', 'Test Editor'], { cwd: repositoryRoot });
  await exec('git', ['config', 'user.email', 'editor@example.invalid'], { cwd: repositoryRoot });
  await writeFile(join(repositoryRoot, '.gitignore'), '*.tmp\n');
  await exec('git', ['add', '--', '.gitignore'], { cwd: repositoryRoot });
  await exec('git', ['commit', '--message', 'initial'], { cwd: repositoryRoot });
  await exec('git', ['remote', 'add', 'origin', origin], { cwd: repositoryRoot });
  await exec('git', ['push', 'origin', 'main'], { cwd: repositoryRoot });
  const ast = structuredClone(identifiedMinima);
  const source =
    sourceOverride ?? Buffer.from('<html><body>Art. 1º Texto da fonte.</body></html>\n');
  const sourceHash = sha(source);
  const visit = (node: Record<string, unknown>): void => {
    node['sourceRef'] = { ...(node['sourceRef'] as object), sourceArtifactSha256: sourceHash };
    if (Array.isArray(node['children']))
      for (const child of node['children']) visit(child as Record<string, unknown>);
  };
  visit(ast as unknown as Record<string, unknown>);
  const revision = {
    revisionHash: calculateRevisionHash(ast, (v) => sha(v)),
    lawTitle: ast.titulo,
    sigla: ast.sigla,
    version: ast.versaoVinculex,
  };
  let publicationGate: Readonly<{ entered(): void; wait: Promise<void> }> | null = null;
  let actorId = USER;
  let current: z.infer<typeof PublicationContextSchema>['current'] = null;
  const history: PublicationHistoryItemDto[] = [];
  const knownIds = new Set<string>();
  const attempts = new Map<string, unknown>();
  let approved = true;
  let role: 'editor_juridico' | 'administrador_tecnico' = 'editor_juridico';
  const calls: { path: string; input: unknown }[] = [];
  const snapshot = {
    ast,
    revisionHash: revision.revisionHash,
    snapshots: [
      {
        sourceType: 'planalto_html' as const,
        sourceRole: 'primary_current' as const,
        sourceVariant: 'compiled' as const,
        sourceUrl: 'https://www.planalto.gov.br/',
        finalUrl: 'https://www.planalto.gov.br/',
        sourceArtifactSha256: sourceHash,
        capturedAt: '2026-10-08T12:00:00.000Z',
        bytes: source,
      },
    ],
  };
  const remote = {
    getActor: () => ({ userId: actorId, role, actorKey: actorId }),
    async request<T>(
      path: string,
      input: unknown,
      schema: { parse(value: unknown): T },
    ): Promise<T> {
      if (
        path === '/publisher' &&
        (input as { action: string }).action === 'publish' &&
        publicationGate !== null
      ) {
        publicationGate.entered();
        await publicationGate.wait;
      }
      return Promise.resolve(
        (() => {
          calls.push({ path, input });
          if (path === '/publication/context')
            return schema.parse({
              lawId: LAW,
              lawTitle: ast.titulo,
              sigla: ast.sigla,
              tipoNorma: ast.tipoNorma,
              numero: ast.numero,
              ano: ast.ano,
              current,
              blockIds: [...knownIds],
              redirects: [],
            });
          if (path === '/publication/history')
            return schema.parse({
              items: history.map((item) => ({
                ...item,
                isCurrent: item.versionId === current?.versionId,
              })),
              nextCursor: null,
              totalItems: history.length,
            });
          if (path === '/publisher') {
            const request = input as {
              action: string;
              publicationId: string;
              manifestDigest?: string;
              candidateSha?: string;
            };
            if (request.action === 'getAttempt')
              return schema.parse(attempts.get(request.publicationId));
            if (request.action === 'approve')
              return schema.parse({
                schemaVersion: 1,
                approvalId: '55555555-5555-4555-8555-555555555555',
                publicationId: request.publicationId,
                userId: USER,
                role: 'editor_juridico',
                manifestDigest: request.manifestDigest,
                approvedAt: '2026-10-08T12:00:00.000Z',
              });
            const result = {
              publicationId: request.publicationId,
              candidateSha: request.candidateSha,
              manifestDigest: (
                calls.find(
                  (c) =>
                    c.path === '/publisher' &&
                    (c.input as { action: string; publicationId: string }).action === 'approve' &&
                    (c.input as { publicationId: string }).publicationId === request.publicationId,
                )?.input as { manifestDigest?: string } | undefined
              )?.manifestDigest,
              publicationAttemptStatus: 'published',
              resumeFromStatus: null,
              publishedVersionId: randomUUID(),
            };
            attempts.set(request.publicationId, result);
            return schema.parse(result);
          }
          throw new Error('Unexpected named operation');
        })(),
      );
    },
  };
  const projects = {
    hasProject: () => true,
    getApprovedRevision: () => (approved ? revision : null),
    getProjectAst: () => ast,
    getPublicationSnapshot: () => {
      if (!approved) throw new Error('CONFLICT');
      return Promise.resolve(snapshot);
    },
  };
  const operationOptions = {
    repositoryRoot,
    storageRoot: join(root, 'data'),
    canonicalBranch: 'main',
    projects,
    remote,
    now: () => new Date('2026-10-08T12:00:00.000Z'),
  };
  const operations = createPublicationOperations(operationOptions);
  return {
    root,
    repositoryRoot,
    origin,
    operations,
    projects,
    revision,
    calls,
    ast,
    snapshot,
    holdPublication() {
      let entered: () => void = () => undefined;
      let release: () => void = () => undefined;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      publicationGate = { entered, wait };
      return { reached, release };
    },
    restart: () => createPublicationOperations(operationOptions),
    async promote(result: PublicationAttemptDto) {
      const proof = await operations.getPreparedProof(result.publicationId);
      const manifest = parseCanonicalPublicationManifest(proof.manifestCanonical);
      const scan = (node: Record<string, unknown>): void => {
        if (typeof node['blockId'] === 'string') knownIds.add(node['blockId']);
        if (Array.isArray(node['children']))
          for (const child of node['children']) scan(child as Record<string, unknown>);
      };
      scan(JSON.parse(proof.identifiedAstCanonical) as Record<string, unknown>);
      if (result.publishedVersionId === null || result.candidateSha === null)
        throw new Error('Unproven fixture publication');
      await exec('git', [
        '--git-dir',
        origin,
        'update-ref',
        'refs/heads/main',
        result.candidateSha,
      ]);
      current = {
        versionId: result.publishedVersionId,
        version: result.version,
        publicationNumber: result.publicationNumber,
        gitCommitSha: result.candidateSha,
      };
      history.unshift({
        ...current,
        lawId: LAW,
        publicationKind: result.publicationKind,
        restoredVersionId: manifest.target.restoredVersionId,
        publishedAt: '2026-10-08T12:00:00.000Z',
        isCurrent: true,
        sourceSummary: manifest.changelog.sourceSummary,
      });
    },
    refreshRevision() {
      revision.revisionHash = calculateRevisionHash(ast, sha);
      snapshot.revisionHash = revision.revisionHash;
    },
    setActor(value: string) {
      actorId = value;
    },
    setApproved: (value: boolean) => {
      approved = value;
    },
    setRole: (value: typeof role) => {
      role = value;
    },
  };
}

describe('production desktop publication operations', () => {
  it('prepares durable canonical bytes and pushes only a candidate branch after confirmation', async () => {
    const s = await setup();
    const capabilities = createPublicationDesktopCapabilities({
      projects: s.projects,
      operations: s.operations,
    });
    const confirmation = await capabilities.preparePublication.handle({
      projectId: PROJECT,
      sourceSummary: 'Fonte oficial conferida.',
    });
    expect(s.calls.some((c) => c.path === '/publisher')).toBe(false);
    const result = await capabilities.executePublication.handle({
      publicationId: confirmation.publicationId,
    });
    expect(result.publicationAttemptStatus).toBe('published');
    expect(result.publishedVersionId).not.toBeNull();
    const candidate = await exec('git', [
      '--git-dir',
      s.origin,
      'rev-parse',
      `refs/heads/releases/${confirmation.publicationId}`,
    ]);
    expect(candidate.stdout.trim()).toBe(result.candidateSha);
    const canonical = await exec('git', ['--git-dir', s.origin, 'rev-parse', 'refs/heads/main']);
    expect(canonical.stdout.trim()).not.toBe(result.candidateSha);
    const branch = await exec('git', ['branch', '--show-current'], { cwd: s.repositoryRoot });
    expect(branch.stdout.trim()).toBe('main');
    const draft = await readFile(
      join(s.root, 'data', 'publication-drafts', `${confirmation.publicationId}.json`),
      'utf8',
    );
    expect(draft).toContain(confirmation.revisionHash);
    expect(draft).not.toMatch(/access_token|refresh_token|password/u);
    expect(
      s.calls
        .filter((c) => c.path === '/publisher')
        .map((c) => (c.input as { action: string }).action),
    ).toEqual(['approve', 'publish']);
  });
  it('blocks an invalidated revision before approval or Git push', async () => {
    const s = await setup();
    const draft = await s.operations.prepare(
      { projectId: PROJECT, sourceSummary: 'Fonte oficial conferida.' },
      s.revision,
    );
    s.setApproved(false);
    await expect(s.operations.execute(draft.publicationId)).rejects.toThrow();
    expect(s.calls.some((c) => c.path === '/publisher')).toBe(false);
    const refs = await exec('git', [
      '--git-dir',
      s.origin,
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads/releases/',
    ]);
    expect(refs.stdout).toBe('');
  });
  it('does not grant editorial publication authority to an administrator', async () => {
    const s = await setup();
    s.setRole('administrador_tecnico');
    await expect(
      s.operations.prepare(
        { projectId: PROJECT, sourceSummary: 'Fonte oficial conferida.' },
        s.revision,
      ),
    ).rejects.toThrow();
    expect(s.calls).toHaveLength(0);
  });
  it('validates every frozen artifact before recording approval or pushing', async () => {
    const s = await setup();
    const draft = await s.operations.prepare(
      { projectId: PROJECT, sourceSummary: 'Fonte conferida.' },
      s.revision,
    );
    const proof = await s.operations.getPreparedProof(draft.publicationId);
    const manifest = parseCanonicalPublicationManifest(proof.manifestCanonical);
    await writeFile(
      join(
        s.root,
        'data',
        'publication-workspaces',
        draft.publicationId,
        'leis',
        manifest.law.directoryName,
        `${s.ast.sigla.toLowerCase()}.md`,
      ),
      'adulterado',
    );
    await expect(s.operations.execute(draft.publicationId)).rejects.toThrow(
      'INVALID_PUBLICATION_ARTIFACT',
    );
    expect(s.calls.some((c) => c.path === '/publisher')).toBe(false);
  });
  it('recovers durable preparation and serializes duplicate confirmation', async () => {
    const s = await setup();
    const draft = await s.operations.prepare(
      { projectId: PROJECT, sourceSummary: 'Fonte conferida.' },
      s.revision,
    );
    const restarted = s.restart();
    expect(await restarted.getPreparedConfirmation(draft.publicationId)).toEqual(draft);
    expect((await restarted.getAttempt(draft.publicationId)).publicationAttemptStatus).toBe(
      'prepared',
    );
    const [first, second] = await Promise.all([
      restarted.execute(draft.publicationId),
      restarted.execute(draft.publicationId),
    ]);
    expect(second).toEqual(first);
    expect(
      s.calls.filter(
        (c) => c.path === '/publisher' && (c.input as { action: string }).action === 'publish',
      ),
    ).toHaveLength(1);
    s.setApproved(false);
    expect(await restarted.retry(draft.publicationId)).toMatchObject({
      publishedVersionId: first.publishedVersionId,
    });
  });
  it('binds durable publication access to its individual author', async () => {
    const s = await setup();
    const draft = await s.operations.prepare(
      { projectId: PROJECT, sourceSummary: 'Fonte conferida.' },
      s.revision,
    );
    s.setActor(randomUUID());
    expect(await s.operations.canAccessPublication(draft.publicationId)).toBe(false);
    await expect(s.operations.execute(draft.publicationId)).rejects.toThrow('NOT_ALLOWED');
    expect(s.calls.some((c) => c.path === '/publisher')).toBe(false);
  });
  it('restores historical bytes as a new approved release and preserves source encoding', async () => {
    const s = await setup(Buffer.from([0xe7, 0xe3, 0x0a]));
    const initial = await s.operations.prepare(
      { projectId: PROJECT, sourceSummary: 'Fonte oficial conferida.' },
      s.revision,
    );
    const first = await s.operations.execute(initial.publicationId);
    await s.promote(first);
    const node = s.ast.children[0];
    if (node?.tipo !== 'artigo') throw new Error('Missing article fixture');
    node.caput = 'Texto jurídico alterado.';
    s.refreshRevision();
    const correction = await s.operations.prepare(
      { projectId: PROJECT, sourceSummary: 'Correção oficial conferida.' },
      s.revision,
    );
    const second = await s.operations.execute(correction.publicationId);
    await s.promote(second);
    if (first.publishedVersionId === null) throw new Error('Missing published version');
    const rollback = await s.operations.prepareRollback({
      projectId: PROJECT,
      restoreVersionId: first.publishedVersionId,
      justification: 'Restaurar o texto histórico após revisão jurídica.',
    });
    expect(rollback).toMatchObject({
      publicationKind: 'rollback',
      publicationNumber: 3,
      restoredVersionId: first.publishedVersionId,
    });
    const proof = await s.operations.getPreparedProof(rollback.publicationId);
    const manifest = parseCanonicalPublicationManifest(proof.manifestCanonical);
    const primary = manifest.sourceSnapshots[0];
    if (primary === undefined) throw new Error('Missing primary snapshot');
    const bytes = await readFile(
      join(
        s.root,
        'data',
        'publication-workspaces',
        rollback.publicationId,
        'leis',
        manifest.law.directoryName,
        '.vinculex',
        'sources',
        `${primary.sourceArtifactSha256}.snapshot`,
      ),
    );
    expect(bytes).toEqual(Buffer.from([0xe7, 0xe3, 0x0a]));
    expect((await s.operations.execute(rollback.publicationId)).publicationAttemptStatus).toBe(
      'published',
    );
  });
  it('recovers an update draft only for its exact durable candidate and baseline', async () => {
    const s = await setup();
    const initial = await s.operations.prepare(
      { projectId: PROJECT, sourceSummary: 'Fonte conferida.' },
      s.revision,
    );
    const published = await s.operations.execute(initial.publicationId);
    await s.promote(published);
    if (published.publishedVersionId === null) throw new Error('Missing baseline');
    const updateId = randomUUID();
    const candidateArtifactId = randomUUID();
    const prepared = await s.operations.prepareSnapshot(
      updateId,
      s.snapshot,
      'Atualização oficial conferida.',
      { updateId, candidateArtifactId },
    );
    const restarted = s.restart();
    expect(
      await restarted.findPreparedUpdate(
        updateId,
        candidateArtifactId,
        s.snapshot.revisionHash,
        published.publishedVersionId,
      ),
    ).toEqual(prepared);
    expect(
      await restarted.findPreparedUpdate(
        updateId,
        randomUUID(),
        s.snapshot.revisionHash,
        published.publishedVersionId,
      ),
    ).toBeNull();
    expect(
      await restarted.findPreparedUpdate(
        updateId,
        candidateArtifactId,
        s.snapshot.revisionHash,
        randomUUID(),
      ),
    ).toBeNull();
  });
  it('does not let another signed-in editor join an in-flight publication', async () => {
    const s = await setup();
    const prepared = await s.operations.prepare(
      { projectId: PROJECT, sourceSummary: 'Fonte conferida.' },
      s.revision,
    );
    const barrier = s.holdPublication();
    const executing = s.operations.execute(prepared.publicationId);
    await barrier.reached;
    s.setActor(randomUUID());
    await expect(s.operations.execute(prepared.publicationId)).rejects.toThrow('NOT_ALLOWED');
    barrier.release();
    expect((await executing).publicationAttemptStatus).toBe('published');
  });
});
