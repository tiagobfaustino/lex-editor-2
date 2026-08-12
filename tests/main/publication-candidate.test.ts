import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  commitAndPushPublicationCandidate,
  runGitCommand,
  type GitCommandRunner,
} from '../../src/main/publication/candidate-git.js';
import { createPublicationJournalStore } from '../../src/main/publication/journal.js';
import {
  calculatePublicationManifestDigest,
  serializePublicationManifest,
} from '../../src/main/publication/manifest.js';

const execFileAsync = promisify(execFile);
const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222';
const LAW_ID = '33333333-3333-4333-8333-333333333333';
const EDITOR_ID = '44444444-4444-4444-8444-444444444444';
const APPROVAL_ID = '77777777-7777-4777-8777-777777777777';

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

const git = async (cwd: string, args: string[]): Promise<string> => {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return result.stdout;
};

const setupRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), 'lex-publication-test-'));
  temporaryRoots.push(root);
  const repositoryRoot = join(root, 'repository');
  const remoteRoot = join(root, 'remote.git');
  const storageRoot = join(root, 'storage');
  await mkdir(repositoryRoot);
  await git(root, ['init', '--bare', remoteRoot]);
  await git(repositoryRoot, ['init', '--initial-branch=main']);
  await git(repositoryRoot, ['config', 'user.name', 'Lex Editor Test']);
  await git(repositoryRoot, ['config', 'user.email', 'lex-editor@example.invalid']);
  await writeFile(join(repositoryRoot, 'README.md'), 'canonical repository\n', 'utf8');
  await git(repositoryRoot, ['add', '--', 'README.md']);
  await git(repositoryRoot, ['commit', '--message', 'base']);
  const baseSha = (await git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  await git(repositoryRoot, ['remote', 'add', 'origin', remoteRoot]);
  return { root, repositoryRoot, remoteRoot, storageRoot, baseSha };
};

const prepareCandidateFiles = async (repositoryRoot: string, baseSha: string) => {
  const astBytes = '{"ast":"identified"}';
  const sourceBytes = '<html>official snapshot</html>\n';
  const sourceSha = createHash('sha256').update(sourceBytes).digest('hex');
  const manifest = {
    schemaVersion: 1 as const,
    publicationId: PUBLICATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    law: { lawId: LAW_ID, directoryName: 'lei-de-introducao' },
    target: {
      version: '1.0.0',
      publicationNumber: 1,
      kind: 'initial' as const,
      impact: 'normative_projection' as const,
      restoredVersionId: null,
    },
    expectedBase: { gitCommitSha: baseSha, publishedVersionId: null },
    artifacts: {
      markdownSha256: createHash('sha256').update('lei\n').digest('hex'),
      updateMarkdownSha256: createHash('sha256').update('update\n').digest('hex'),
      identifiedAstSha256: createHash('sha256').update(astBytes).digest('hex'),
    },
    sourceSnapshots: [
      {
        sourceType: 'planalto_html' as const,
        sourceRole: 'primary_current' as const,
        sourceVariant: 'compiled' as const,
        sourceUrl: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
        finalUrl: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
        sourceArtifactSha256: sourceSha,
        capturedAt: '2026-08-10T14:00:00.000Z',
      },
    ],
    approvedBy: { userId: EDITOR_ID, role: 'editor_juridico' as const },
    changelog: {
      publicationDate: '2026-08-10',
      version: '1.0.0',
      publicationNumber: 1,
      kind: 'initial' as const,
      sourceSummary: 'Importação conferida em fonte oficial.',
      changes: {
        included: [{ blockId: 'ldem-art-1', description: 'Art. 1 incluído.' }],
        amended: [],
        revoked: [],
        renumbered: [],
      },
    },
    preparedAt: '2026-08-10T15:00:00.000Z',
  };
  const manifestCanonical = serializePublicationManifest(manifest);
  const lawRoot = join(repositoryRoot, 'leis', 'lei-de-introducao');
  const releasesRoot = join(lawRoot, '.vinculex', 'releases');
  await mkdir(releasesRoot, { recursive: true });
  await writeFile(join(lawRoot, 'lei-de-introducao.md'), 'lei\n', 'utf8');
  await writeFile(join(lawRoot, 'UPDATE.md'), 'update\n', 'utf8');
  await writeFile(join(releasesRoot, '000001-1.0.0.json'), manifestCanonical, 'utf8');
  await writeFile(join(releasesRoot, '000001-1.0.0.ast.json'), astBytes, 'utf8');
  const sourcesRoot = join(lawRoot, '.vinculex', 'sources');
  await mkdir(sourcesRoot, { recursive: true });
  await writeFile(join(sourcesRoot, `${sourceSha}.snapshot`), sourceBytes, 'utf8');
  const approval = {
    schemaVersion: 1 as const,
    approvalId: APPROVAL_ID,
    publicationId: PUBLICATION_ID,
    manifestDigest: calculatePublicationManifestDigest(manifest),
    userId: EDITOR_ID,
    role: 'editor_juridico' as const,
    approvedAt: '2026-08-10T16:00:00.000Z',
  };
  return { manifestCanonical, approval, sourceSha };
};

const ids = () => {
  let sequence = 8;
  return () => {
    const suffix = String(sequence).padStart(12, '0');
    sequence += 1;
    return `88888888-8888-4888-8888-${suffix}`;
  };
};

const candidateInput = (
  fixture: Awaited<ReturnType<typeof setupRepository>>,
  files: Awaited<ReturnType<typeof prepareCandidateFiles>>,
) => ({
  repositoryRoot: fixture.repositoryRoot,
  storageRoot: fixture.storageRoot,
  manifestCanonical: files.manifestCanonical,
  approval: files.approval,
  markdownRelativePath: 'leis/lei-de-introducao/lei-de-introducao.md',
});

describe('publication candidate Git and durable journal', () => {
  it('commits only the derived release paths and pushes only the candidate ref', async () => {
    const fixture = await setupRepository();
    const files = await prepareCandidateFiles(fixture.repositoryRoot, fixture.baseSha);
    const commands: readonly string[][] = [];
    const recordedCommands: string[][] = commands as string[][];
    const runner: GitCommandRunner = async (args, options) => {
      recordedCommands.push([...args]);
      return runGitCommand(args, options);
    };

    const journal = await commitAndPushPublicationCandidate(candidateInput(fixture, files), {
      runner,
      generateUuid: ids(),
      now: () => new Date('2026-08-10T17:00:00.000Z'),
    });

    const commitSha = journal.events.find((event) => event.status === 'pushed')?.gitCommitSha;
    expect(commitSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(journal.events.map((event) => event.status)).toEqual([
      'prepared',
      'committed_local',
      'pushed',
    ]);
    expect(recordedCommands.find((args) => args[0] === 'push')).toEqual([
      'push',
      '--porcelain',
      'origin',
      `${String(commitSha)}:refs/heads/releases/${PUBLICATION_ID}`,
    ]);
    expect(
      (await git(fixture.remoteRoot, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).trim(),
    ).toBe(`refs/heads/releases/${PUBLICATION_ID}`);
    expect(
      (
        await git(fixture.repositoryRoot, [
          'diff',
          '--name-only',
          fixture.baseSha,
          String(commitSha),
        ])
      )
        .trim()
        .split('\n')
        .sort(),
    ).toEqual([
      'leis/lei-de-introducao/.vinculex/releases/000001-1.0.0.ast.json',
      'leis/lei-de-introducao/.vinculex/releases/000001-1.0.0.json',
      `leis/lei-de-introducao/.vinculex/sources/${files.sourceSha}.snapshot`,
      'leis/lei-de-introducao/UPDATE.md',
      'leis/lei-de-introducao/lei-de-introducao.md',
    ]);

    const journalPath = join(
      fixture.storageRoot,
      'publication-attempts',
      PUBLICATION_ID,
      'journal.json',
    );
    expect((await stat(journalPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(journalPath, '..'))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(journalPath, 'utf8'))).toEqual(journal);

    const retried = await commitAndPushPublicationCandidate(candidateInput(fixture, files));
    expect(retried).toEqual(journal);

    await writeFile(
      journalPath,
      `${JSON.stringify({ ...journal, manifestDigest: 'f'.repeat(64) })}\n`,
      'utf8',
    );
    await expect(
      createPublicationJournalStore(fixture.storageRoot).load(PUBLICATION_ID),
    ).rejects.toMatchObject({ code: 'invalid_journal' });
  });

  it('reuses an immutable source snapshot already present in the approved base', async () => {
    const initial = await setupRepository();
    const sourceBytes = '<html>official snapshot</html>\n';
    const sourceSha = createHash('sha256').update(sourceBytes).digest('hex');
    const sourcesRoot = join(
      initial.repositoryRoot,
      'leis',
      'lei-de-introducao',
      '.vinculex',
      'sources',
    );
    await mkdir(sourcesRoot, { recursive: true });
    const snapshotPath = `leis/lei-de-introducao/.vinculex/sources/${sourceSha}.snapshot`;
    await writeFile(join(initial.repositoryRoot, snapshotPath), sourceBytes, 'utf8');
    await git(initial.repositoryRoot, ['add', '--', snapshotPath]);
    await git(initial.repositoryRoot, ['commit', '--message', 'store immutable source snapshot']);
    const fixture = {
      ...initial,
      baseSha: (await git(initial.repositoryRoot, ['rev-parse', 'HEAD'])).trim(),
    };
    const files = await prepareCandidateFiles(fixture.repositoryRoot, fixture.baseSha);

    const journal = await commitAndPushPublicationCandidate(candidateInput(fixture, files), {
      generateUuid: ids(),
      now: () => new Date('2026-08-10T17:00:00.000Z'),
    });
    const commitSha = journal.events.find((event) => event.status === 'pushed')?.gitCommitSha;
    const changed = (
      await git(fixture.repositoryRoot, ['diff', '--name-only', fixture.baseSha, String(commitSha)])
    )
      .trim()
      .split('\n');

    expect(changed).not.toContain(snapshotPath);
    expect(
      await git(fixture.repositoryRoot, ['show', `${String(commitSha)}:${snapshotPath}`]),
    ).toBe(sourceBytes);
    expect(journal.artifactRelativePaths).toContain(snapshotPath);
  });

  it('records a push failure at the last safe SHA and resumes without another commit', async () => {
    const fixture = await setupRepository();
    const files = await prepareCandidateFiles(fixture.repositoryRoot, fixture.baseSha);
    let failPush = true;
    const runner: GitCommandRunner = async (args, options) => {
      if (args[0] === 'push' && failPush) {
        failPush = false;
        return { exitCode: 1, stdout: '' };
      }
      return runGitCommand(args, options);
    };
    const generateUuid = ids();

    await expect(
      commitAndPushPublicationCandidate(candidateInput(fixture, files), {
        runner,
        generateUuid,
        now: () => new Date('2026-08-10T17:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'git_push_failed' });

    const store = createPublicationJournalStore(fixture.storageRoot);
    const failed = await store.load(PUBLICATION_ID);
    expect(failed?.events.map((event) => event.status)).toEqual([
      'prepared',
      'committed_local',
      'failed',
    ]);
    const commitSha = failed?.events.find(
      (event) => event.status === 'committed_local',
    )?.gitCommitSha;
    expect(failed?.events.at(-1)).toMatchObject({
      status: 'failed',
      resumeFromStatus: 'committed_local',
      gitCommitSha: commitSha,
    });

    const retried = await commitAndPushPublicationCandidate(candidateInput(fixture, files), {
      runner,
      generateUuid,
      now: () => new Date('2026-08-10T17:01:00.000Z'),
    });
    expect(retried.events.map((event) => event.status)).toEqual([
      'prepared',
      'committed_local',
      'failed',
      'pushed',
    ]);
    expect(retried.events.filter((event) => event.status === 'committed_local')).toHaveLength(1);
  });

  it('recovers when the commit succeeds but the command response is lost', async () => {
    const fixture = await setupRepository();
    const files = await prepareCandidateFiles(fixture.repositoryRoot, fixture.baseSha);
    let loseCommitResponse = true;
    let commitCalls = 0;
    const runner: GitCommandRunner = async (args, options) => {
      if (args[0] === 'commit') {
        commitCalls += 1;
        const result = await runGitCommand(args, options);
        if (loseCommitResponse) {
          loseCommitResponse = false;
          return { ...result, exitCode: 1 };
        }
        return result;
      }
      return runGitCommand(args, options);
    };
    const generateUuid = ids();

    await expect(
      commitAndPushPublicationCandidate(candidateInput(fixture, files), {
        runner,
        generateUuid,
        now: () => new Date('2026-08-10T17:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'git_commit_failed' });

    const recovered = await commitAndPushPublicationCandidate(candidateInput(fixture, files), {
      runner,
      generateUuid,
      now: () => new Date('2026-08-10T17:01:00.000Z'),
    });
    expect(recovered.events.map((event) => event.status)).toEqual([
      'prepared',
      'failed',
      'committed_local',
      'pushed',
    ]);
    expect(commitCalls).toBe(1);
  });

  it('recovers when the push succeeds but the command response is lost', async () => {
    const fixture = await setupRepository();
    const files = await prepareCandidateFiles(fixture.repositoryRoot, fixture.baseSha);
    let losePushResponse = true;
    let pushCalls = 0;
    const runner: GitCommandRunner = async (args, options) => {
      if (args[0] === 'push') {
        pushCalls += 1;
        const result = await runGitCommand(args, options);
        if (losePushResponse) {
          losePushResponse = false;
          return { ...result, exitCode: 1 };
        }
        return result;
      }
      return runGitCommand(args, options);
    };
    const generateUuid = ids();

    await expect(
      commitAndPushPublicationCandidate(candidateInput(fixture, files), {
        runner,
        generateUuid,
        now: () => new Date('2026-08-10T17:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'git_push_failed' });

    const store = createPublicationJournalStore(fixture.storageRoot);
    const failed = await store.load(PUBLICATION_ID);
    const commitSha = failed?.events.find(
      (event) => event.status === 'committed_local',
    )?.gitCommitSha;
    expect(
      (
        await git(fixture.remoteRoot, ['rev-parse', `refs/heads/releases/${PUBLICATION_ID}`])
      ).trim(),
    ).toBe(commitSha);

    const recovered = await commitAndPushPublicationCandidate(candidateInput(fixture, files), {
      runner,
      generateUuid,
      now: () => new Date('2026-08-10T17:01:00.000Z'),
    });
    expect(recovered.events.filter((event) => event.status === 'committed_local')).toHaveLength(1);
    expect(recovered.events.at(-1)).toMatchObject({ status: 'pushed', gitCommitSha: commitSha });
    expect(pushCalls).toBe(2);
  });

  it('blocks a stale base before creating or pushing a candidate commit', async () => {
    const fixture = await setupRepository();
    const files = await prepareCandidateFiles(fixture.repositoryRoot, fixture.baseSha);
    await writeFile(join(fixture.repositoryRoot, 'README.md'), 'new base\n', 'utf8');
    await git(fixture.repositoryRoot, ['add', '--', 'README.md']);
    await git(fixture.repositoryRoot, ['commit', '--message', 'concurrent publication']);

    await expect(
      commitAndPushPublicationCandidate(candidateInput(fixture, files), {
        generateUuid: ids(),
        now: () => new Date('2026-08-10T17:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'git_base_conflict' });
    expect(
      (await git(fixture.remoteRoot, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).trim(),
    ).toBe('');
  });

  it('rejects a pre-staged extra path instead of including it in the release commit', async () => {
    const fixture = await setupRepository();
    const files = await prepareCandidateFiles(fixture.repositoryRoot, fixture.baseSha);
    await writeFile(join(fixture.repositoryRoot, 'unexpected.txt'), 'must not ship\n', 'utf8');
    await git(fixture.repositoryRoot, ['add', '--', 'unexpected.txt']);

    await expect(
      commitAndPushPublicationCandidate(candidateInput(fixture, files), {
        generateUuid: ids(),
        now: () => new Date('2026-08-10T17:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'unsafe_candidate' });
    expect((await git(fixture.repositoryRoot, ['rev-parse', 'HEAD'])).trim()).toBe(fixture.baseSha);
  });
});
