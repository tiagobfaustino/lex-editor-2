import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  deriveStructuredChanges,
  formatar,
  generateUpdateMarkdown,
  identifiedMinima,
} from '@lex-editor/legal-domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createInMemoryPublicationApprovalRepository,
  createPublicationApprovalAuthority,
} from '../../services/publisher/src/approval.js';
import { createPublisherGitRepository } from '../../services/publisher/src/git-repository.js';
import { createPublisherService } from '../../services/publisher/src/service.js';
import type { PublicationBaselineRepository } from '../../services/publisher/src/validation.js';
import type {
  PublisherAttemptRecord,
  PublisherAttemptRepository,
  PublisherTransactionGateway,
} from '../../services/publisher/src/workflow.js';
import {
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  publicationSourceSnapshotRelativePath,
  serializeCanonicalJson,
  serializePublicationManifest,
} from '../../src/shared/publication/manifest.js';

const execFileAsync = promisify(execFile);
const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222';
const LAW_ID = '33333333-3333-4333-8333-333333333333';
const EDITOR_ID = '44444444-4444-4444-8444-444444444444';
const APPROVAL_ID = '77777777-7777-4777-8777-777777777777';
const TOKEN = 'editor-access-token-for-tests';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true })));
});

const git = async (cwd: string, args: string[]): Promise<string> => {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return result.stdout;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type FixtureMutation = 'manifest_tampered' | 'extra_path' | 'secret_markdown';

const createFixture = async (
  options: Readonly<{
    reuseSnapshot?: boolean;
    mutation?: FixtureMutation;
  }> = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'lex-publisher-test-'));
  roots.push(root);
  const work = join(root, 'work');
  const remote = join(root, 'remote.git');
  const mirror = join(root, 'publisher.git');
  await mkdir(work);
  await git(root, ['init', '--bare', remote]);
  await git(work, ['init', '--initial-branch=main']);
  await git(work, ['config', 'user.name', 'Lex Publisher Test']);
  await git(work, ['config', 'user.email', 'publisher@example.invalid']);
  await writeFile(join(work, 'README.md'), 'canonical\n', 'utf8');
  await git(work, ['add', '--', 'README.md']);
  await git(work, ['commit', '--message', 'base']);
  let baseSha = (await git(work, ['rev-parse', 'HEAD'])).trim();
  await git(work, ['remote', 'add', 'origin', remote]);

  const snapshot = '<html>snapshot oficial</html>\n';
  const snapshotSha = createHash('sha256').update(snapshot).digest('hex');
  if (options.reuseSnapshot === true) {
    const existingSourcesRoot = join(work, 'leis', 'lei-de-demonstracao', '.vinculex', 'sources');
    await mkdir(existingSourcesRoot, { recursive: true });
    await writeFile(join(existingSourcesRoot, `${snapshotSha}.snapshot`), snapshot, 'utf8');
    await git(work, ['add', '--', 'leis/lei-de-demonstracao/.vinculex/sources']);
    await git(work, ['commit', '--message', 'store immutable source snapshot']);
    baseSha = (await git(work, ['rev-parse', 'HEAD'])).trim();
  }
  await git(work, ['push', 'origin', 'main:refs/heads/main']);
  const ast = clone(identifiedMinima);
  const updateReferences = (node: Record<string, unknown>): void => {
    const sourceRef = node['sourceRef'];
    if (typeof sourceRef !== 'object' || sourceRef === null || Array.isArray(sourceRef)) {
      throw new TypeError('The fixture node must have a sourceRef object.');
    }
    node['sourceRef'] = {
      ...sourceRef,
      sourceArtifactSha256: snapshotSha,
    };
    const children = node['children'];
    if (Array.isArray(children)) {
      for (const child of children) updateReferences(child as Record<string, unknown>);
    }
  };
  updateReferences(ast as unknown as Record<string, unknown>);
  ast.publicationStatus = 'approved';
  const astCanonical = serializeCanonicalJson(ast);
  const formatted = formatar(ast);
  if (!formatted.ok) throw new Error('Invalid AST fixture.');
  const changes = deriveStructuredChanges(null, ast);
  const changelog = {
    publicationDate: '2026-08-10',
    version: '1.0.0',
    publicationNumber: 1,
    kind: 'initial' as const,
    sourceSummary: 'Importação conferida em fonte oficial.',
    changes,
  };
  const updateMarkdown = generateUpdateMarkdown([changelog]);
  const manifest = {
    schemaVersion: 1 as const,
    publicationId: PUBLICATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    law: { lawId: LAW_ID, directoryName: 'lei-de-demonstracao' },
    target: {
      version: '1.0.0',
      publicationNumber: 1,
      kind: 'initial' as const,
      impact: 'normative_projection' as const,
      restoredVersionId: null,
    },
    expectedBase: { gitCommitSha: baseSha, publishedVersionId: null },
    artifacts: {
      markdownSha256: createHash('sha256').update(formatted.valor).digest('hex'),
      updateMarkdownSha256: createHash('sha256').update(updateMarkdown).digest('hex'),
      identifiedAstSha256: createHash('sha256').update(astCanonical).digest('hex'),
    },
    sourceSnapshots: [
      {
        sourceType: 'planalto_html' as const,
        sourceRole: 'primary_current' as const,
        sourceVariant: 'compiled' as const,
        sourceArtifactSha256: snapshotSha,
        capturedAt: '2026-08-10T14:00:00.000Z',
      },
    ],
    approvedBy: { userId: EDITOR_ID, role: 'editor_juridico' as const },
    changelog,
    preparedAt: '2026-08-10T15:00:00.000Z',
  };
  const manifestCanonical = serializePublicationManifest(manifest);
  const lawRoot = join(work, 'leis', 'lei-de-demonstracao');
  await mkdir(join(lawRoot, '.vinculex', 'releases'), { recursive: true });
  await mkdir(join(lawRoot, '.vinculex', 'sources'), { recursive: true });
  await writeFile(
    join(lawRoot, 'ldem.md'),
    options.mutation === 'secret_markdown'
      ? 'SUPABASE_SECRET_KEY=sb_secret_not-a-real-secret-value\n'
      : formatted.valor,
    'utf8',
  );
  await writeFile(join(lawRoot, 'UPDATE.md'), updateMarkdown, 'utf8');
  await writeFile(
    join(work, publicationManifestRelativePath('lei-de-demonstracao', 1, '1.0.0')),
    options.mutation === 'manifest_tampered'
      ? serializePublicationManifest({
          ...manifest,
          changelog: {
            ...manifest.changelog,
            sourceSummary: 'Conteúdo adulterado depois da aprovação.',
          },
        })
      : manifestCanonical,
    'utf8',
  );
  await writeFile(
    join(work, publicationIdentifiedAstRelativePath('lei-de-demonstracao', 1, '1.0.0')),
    astCanonical,
    'utf8',
  );
  await writeFile(
    join(work, publicationSourceSnapshotRelativePath('lei-de-demonstracao', snapshotSha)),
    snapshot,
    'utf8',
  );
  if (options.mutation === 'extra_path') {
    await writeFile(join(lawRoot, 'unexpected.txt'), 'arquivo não aprovado\n', 'utf8');
  }
  await git(work, ['switch', '--create', `releases/${PUBLICATION_ID}`]);
  await git(work, ['add', '--', 'leis/lei-de-demonstracao']);
  await git(work, ['commit', '--message', `release: ${PUBLICATION_ID} v1.0.0`]);
  const candidateSha = (await git(work, ['rev-parse', 'HEAD'])).trim();
  await git(work, ['push', 'origin', `${candidateSha}:refs/heads/releases/${PUBLICATION_ID}`]);
  await git(root, ['clone', '--mirror', remote, mirror]);

  const approvals = createInMemoryPublicationApprovalRepository();
  const authority = createPublicationApprovalAuthority({
    identities: {
      findByUserId(userId) {
        return Promise.resolve(
          userId === EDITOR_ID
            ? { userId, accountStatus: 'active' as const, roles: ['editor_juridico'] }
            : null,
        );
      },
    },
    approvals,
    generateUuid: () => APPROVAL_ID,
    now: () => new Date('2026-08-10T16:00:00.000Z'),
  });
  await authority.approve(EDITOR_ID, {
    publicationId: PUBLICATION_ID,
    manifestDigest: createHash('sha256').update(manifestCanonical).digest('hex'),
  });
  const baselines: PublicationBaselineRepository = {
    getByLawId(lawId) {
      return Promise.resolve({
        lawId,
        publishedVersionId: null,
        gitCommitSha: null,
        version: null,
        publicationNumber: null,
        ast: null,
        historicalBlockIds: [],
        redirects: [],
      });
    },
    versionBelongsToLaw() {
      return Promise.resolve(false);
    },
  };
  return {
    root,
    work,
    remote,
    mirror,
    baseSha,
    candidateSha,
    manifest,
    manifestCanonical,
    authority,
    baselines,
  };
};

const createAttemptInfrastructure = (
  options: Readonly<{
    failFirstSync?: boolean;
    loseFirstPrepareResponse?: boolean;
    loseFirstMarkSyncingResponse?: boolean;
    loseFirstCommittedResponse?: boolean;
  }> = {},
) => {
  let record: PublisherAttemptRecord | null = null;
  let shouldFail = options.failFirstSync ?? false;
  let shouldLosePrepareResponse = options.loseFirstPrepareResponse ?? false;
  let shouldLoseMarkSyncingResponse = options.loseFirstMarkSyncingResponse ?? false;
  let shouldLoseCommittedResponse = options.loseFirstCommittedResponse ?? false;
  const attempts: PublisherAttemptRepository = {
    findByPublicationId(publicationId, actorUserId) {
      return Promise.resolve(
        record?.publicationId === publicationId && actorUserId === EDITOR_ID ? record : null,
      );
    },
    findPublished(publicationId, candidateSha, actorUserId) {
      return Promise.resolve(
        record?.publicationAttemptStatus === 'published' &&
          record.publicationId === publicationId &&
          record.candidateSha === candidateSha &&
          actorUserId === EDITOR_ID
          ? record
          : null,
      );
    },
    prepare(candidate) {
      record ??= {
        publicationId: candidate.publicationId,
        candidateSha: candidate.candidateSha,
        manifestDigest: candidate.manifestDigest,
        publicationAttemptStatus: 'pushed',
        resumeFromStatus: null,
        publishedVersionId: null,
      };
      if (shouldLosePrepareResponse) {
        shouldLosePrepareResponse = false;
        return Promise.reject(new Error('response lost after prepare'));
      }
      return Promise.resolve(record);
    },
    markSyncing() {
      if (record === null) throw new Error('Attempt missing.');
      record = { ...record, publicationAttemptStatus: 'syncing', resumeFromStatus: null };
      if (shouldLoseMarkSyncingResponse) {
        shouldLoseMarkSyncingResponse = false;
        return Promise.reject(new Error('response lost after mark syncing'));
      }
      return Promise.resolve(record);
    },
    markFailed(_publicationId, _candidateSha, resumeFromStatus) {
      if (record === null) throw new Error('Attempt missing.');
      record = { ...record, publicationAttemptStatus: 'failed', resumeFromStatus };
      return Promise.resolve(record);
    },
  };
  const transaction: PublisherTransactionGateway = {
    publishValidated() {
      if (shouldFail) {
        shouldFail = false;
        return Promise.reject(new Error('database unavailable'));
      }
      if (record === null) throw new Error('Attempt missing.');
      record = {
        ...record,
        publicationAttemptStatus: 'published',
        resumeFromStatus: null,
        publishedVersionId: '99999999-9999-4999-8999-999999999999',
      };
      if (shouldLoseCommittedResponse) {
        shouldLoseCommittedResponse = false;
        return Promise.reject(new Error('response lost after commit'));
      }
      return Promise.resolve(record);
    },
  };
  return { attempts, transaction, current: () => record };
};

describe('authenticated publisher service', () => {
  it('fetches, fully revalidates, promotes and publishes the exact candidate SHA', async () => {
    const fixture = await createFixture();
    const gitRepository = await createPublisherGitRepository({
      repositoryRoot: fixture.mirror,
    });
    const infrastructure = createAttemptInfrastructure();
    const service = createPublisherService({
      authenticator: {
        authenticate(token) {
          return Promise.resolve(token === TOKEN ? { userId: EDITOR_ID } : null);
        },
      },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });

    const result = await service.publish(TOKEN, {
      publicationId: PUBLICATION_ID,
      candidateSha: fixture.candidateSha,
    });

    expect(result).toMatchObject({
      publicationAttemptStatus: 'published',
      candidateSha: fixture.candidateSha,
    });
    expect((await git(fixture.remote, ['rev-parse', 'refs/heads/main'])).trim()).toBe(
      fixture.candidateSha,
    );
  });

  it('accepts a candidate that safely reuses a content-addressed snapshot from its base', async () => {
    const fixture = await createFixture({ reuseSnapshot: true });
    const gitRepository = await createPublisherGitRepository({ repositoryRoot: fixture.mirror });
    const infrastructure = createAttemptInfrastructure();
    const service = createPublisherService({
      authenticator: { authenticate: () => Promise.resolve({ userId: EDITOR_ID }) },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });

    const changedPaths = await git(fixture.work, [
      'diff',
      '--name-only',
      fixture.baseSha,
      fixture.candidateSha,
    ]);
    expect(changedPaths).not.toContain('.vinculex/sources/');
    await expect(
      service.publish(TOKEN, {
        publicationId: PUBLICATION_ID,
        candidateSha: fixture.candidateSha,
      }),
    ).resolves.toMatchObject({ publicationAttemptStatus: 'published' });
  });

  it('keeps a promoted SHA resumable when the database fails and retries without another commit', async () => {
    const fixture = await createFixture();
    const gitRepository = await createPublisherGitRepository({ repositoryRoot: fixture.mirror });
    const infrastructure = createAttemptInfrastructure({ failFirstSync: true });
    const service = createPublisherService({
      authenticator: { authenticate: () => Promise.resolve({ userId: EDITOR_ID }) },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });
    const request = { publicationId: PUBLICATION_ID, candidateSha: fixture.candidateSha };

    await expect(service.publish(TOKEN, request)).rejects.toMatchObject({ code: 'sync_failed' });
    expect(infrastructure.current()).toMatchObject({
      publicationAttemptStatus: 'failed',
      resumeFromStatus: 'syncing',
      candidateSha: fixture.candidateSha,
    });
    await expect(service.getAttempt(TOKEN, PUBLICATION_ID)).resolves.toMatchObject({
      publicationAttemptStatus: 'failed',
      resumeFromStatus: 'syncing',
      publicationId: PUBLICATION_ID,
    });
    await expect(service.publish(TOKEN, request)).resolves.toMatchObject({
      publicationAttemptStatus: 'published',
      candidateSha: fixture.candidateSha,
    });
    expect(
      (
        await git(fixture.remote, [
          'rev-list',
          '--count',
          `${fixture.baseSha}..${fixture.candidateSha}`,
        ])
      ).trim(),
    ).toBe('1');
  });

  it('returns the completed attempt when the transaction committed but its response was lost', async () => {
    const fixture = await createFixture();
    const gitRepository = await createPublisherGitRepository({ repositoryRoot: fixture.mirror });
    const infrastructure = createAttemptInfrastructure({ loseFirstCommittedResponse: true });
    const service = createPublisherService({
      authenticator: { authenticate: () => Promise.resolve({ userId: EDITOR_ID }) },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });
    const request = { publicationId: PUBLICATION_ID, candidateSha: fixture.candidateSha };
    const recovered = await service.publish(TOKEN, request);

    expect(recovered).toMatchObject({
      publicationAttemptStatus: 'published',
      candidateSha: fixture.candidateSha,
      publishedVersionId: '99999999-9999-4999-8999-999999999999',
    });
    await expect(service.publish(TOKEN, request)).resolves.toEqual(recovered);
  });

  it.each([
    ['preparation', { loseFirstPrepareResponse: true }],
    ['sync transition', { loseFirstMarkSyncingResponse: true }],
  ])('recovers when the %s response is lost after persistence', async (_stage, options) => {
    const fixture = await createFixture();
    const gitRepository = await createPublisherGitRepository({ repositoryRoot: fixture.mirror });
    const infrastructure = createAttemptInfrastructure(options);
    const service = createPublisherService({
      authenticator: { authenticate: () => Promise.resolve({ userId: EDITOR_ID }) },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });

    await expect(
      service.publish(TOKEN, {
        publicationId: PUBLICATION_ID,
        candidateSha: fixture.candidateSha,
      }),
    ).resolves.toMatchObject({
      publicationAttemptStatus: 'published',
      candidateSha: fixture.candidateSha,
    });
  });

  it('recovers when Git promotes the SHA but its response is lost', async () => {
    const fixture = await createFixture();
    const actualGit = await createPublisherGitRepository({ repositoryRoot: fixture.mirror });
    let losePromotionResponse = true;
    const gitRepository = {
      ...actualGit,
      async promoteExactCommit(commitSha: string, expectedBaseSha: string) {
        await actualGit.promoteExactCommit(commitSha, expectedBaseSha);
        if (losePromotionResponse) {
          losePromotionResponse = false;
          throw new Error('response lost after Git promotion');
        }
      },
    };
    const infrastructure = createAttemptInfrastructure();
    const service = createPublisherService({
      authenticator: { authenticate: () => Promise.resolve({ userId: EDITOR_ID }) },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });

    await expect(
      service.publish(TOKEN, {
        publicationId: PUBLICATION_ID,
        candidateSha: fixture.candidateSha,
      }),
    ).resolves.toMatchObject({
      publicationAttemptStatus: 'published',
      candidateSha: fixture.candidateSha,
    });
    expect((await git(fixture.remote, ['rev-parse', 'refs/heads/main'])).trim()).toBe(
      fixture.candidateSha,
    );
  });

  it('rejects unauthenticated requests before reading or promoting Git', async () => {
    const fixture = await createFixture();
    const gitRepository = await createPublisherGitRepository({ repositoryRoot: fixture.mirror });
    const infrastructure = createAttemptInfrastructure();
    const service = createPublisherService({
      authenticator: { authenticate: () => Promise.resolve(null) },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });

    await expect(
      service.publish(TOKEN, {
        publicationId: PUBLICATION_ID,
        candidateSha: fixture.candidateSha,
      }),
    ).rejects.toThrow(/autenticação/u);
    expect((await git(fixture.remote, ['rev-parse', 'refs/heads/main'])).trim()).toBe(
      fixture.baseSha,
    );
  });

  it.each([
    ['an altered manifest after approval', 'manifest_tampered', 'approval_mismatch'],
    ['an additional unapproved path', 'extra_path', 'invalid_candidate'],
    ['a credential pattern in an artifact', 'secret_markdown', 'secret_detected'],
  ] as const)('rejects %s without promoting the candidate', async (_scenario, mutation, code) => {
    const fixture = await createFixture({ mutation });
    const gitRepository = await createPublisherGitRepository({ repositoryRoot: fixture.mirror });
    const infrastructure = createAttemptInfrastructure();
    const service = createPublisherService({
      authenticator: { authenticate: () => Promise.resolve({ userId: EDITOR_ID }) },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });

    await expect(
      service.publish(TOKEN, {
        publicationId: PUBLICATION_ID,
        candidateSha: fixture.candidateSha,
      }),
    ).rejects.toMatchObject({ code });
    expect((await git(fixture.remote, ['rev-parse', 'refs/heads/main'])).trim()).toBe(
      fixture.baseSha,
    );
    expect(infrastructure.current()).toBeNull();
  });

  it('rejects a stale canonical base without promoting the candidate', async () => {
    const fixture = await createFixture();
    await git(fixture.work, ['switch', 'main']);
    await writeFile(join(fixture.work, 'README.md'), 'concurrent canonical update\n', 'utf8');
    await git(fixture.work, ['add', '--', 'README.md']);
    await git(fixture.work, ['commit', '--message', 'concurrent canonical update']);
    await git(fixture.work, ['push', 'origin', 'main:refs/heads/main']);
    const advancedMain = (await git(fixture.work, ['rev-parse', 'HEAD'])).trim();
    const gitRepository = await createPublisherGitRepository({ repositoryRoot: fixture.mirror });
    const infrastructure = createAttemptInfrastructure();
    const service = createPublisherService({
      authenticator: { authenticate: () => Promise.resolve({ userId: EDITOR_ID }) },
      approvals: fixture.authority,
      git: gitRepository,
      baselines: fixture.baselines,
      ...infrastructure,
    });

    await expect(
      service.publish(TOKEN, {
        publicationId: PUBLICATION_ID,
        candidateSha: fixture.candidateSha,
      }),
    ).rejects.toMatchObject({ code: 'canonical_base_changed' });
    expect((await git(fixture.remote, ['rev-parse', 'refs/heads/main'])).trim()).toBe(advancedMain);
    expect(infrastructure.current()).toBeNull();
  });
});
