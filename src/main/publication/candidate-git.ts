import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  publicationApprovalSchema,
  type PublicationApproval,
} from '../../shared/publication/approval.js';
import {
  calculatePublicationManifestDigest,
  parseCanonicalPublicationManifest,
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  publicationSourceSnapshotRelativePath,
  type PublicationManifest,
} from './manifest.js';
import {
  createPublicationJournalStore,
  getProvenPublicationState,
  publicationJournalSchema,
  type PublicationJournal,
  type PublicationJournalStore,
} from './journal.js';

const execFileAsync = promisify(execFile);
const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const MARKDOWN_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;

export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type GitCommandRunner = (
  args: readonly string[],
  options: Readonly<{ cwd: string }>,
) => Promise<GitCommandResult>;

const gitEnvironment = (): NodeJS.ProcessEnv => {
  const allowed = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SSH_AUTH_SOCK',
    'GIT_ASKPASS',
    'SSH_ASKPASS',
    'XDG_CONFIG_HOME',
  ] as const;
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
};

export const runGitCommand: GitCommandRunner = async (args, options) => {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      env: gitEnvironment(),
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
    return { exitCode: 0, stdout: result.stdout };
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'number') {
      const stdout = 'stdout' in error ? String(error.stdout) : '';
      return { exitCode: error.code, stdout };
    }
    throw error;
  }
};

export class PublicationCandidateError extends Error {
  constructor(
    readonly code:
      | 'unsafe_repository'
      | 'unsafe_candidate'
      | 'git_base_conflict'
      | 'git_commit_failed'
      | 'git_push_failed',
    message: string,
  ) {
    super(message);
  }
}

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};

const runChecked = async (
  runner: GitCommandRunner,
  cwd: string,
  args: readonly string[],
  code: PublicationCandidateError['code'],
): Promise<string> => {
  const result = await runner(args, { cwd });
  if (result.exitCode !== 0) {
    throw new PublicationCandidateError(code, 'A operação Git segura não pôde ser concluída.');
  }
  return result.stdout;
};

const prepareRepository = async (
  repositoryRoot: string,
  runner: GitCommandRunner,
): Promise<string> => {
  const info = await lstat(repositoryRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PublicationCandidateError(
      'unsafe_repository',
      'A raiz do repositório não é um diretório seguro.',
    );
  }
  const root = await realpath(repositoryRoot);
  const topLevel = (
    await runChecked(runner, root, ['rev-parse', '--show-toplevel'], 'unsafe_repository')
  ).trim();
  if ((await realpath(topLevel)) !== root) {
    throw new PublicationCandidateError(
      'unsafe_repository',
      'A raiz configurada não coincide com o repositório Git.',
    );
  }
  return root;
};

const validateArtifactPaths = (
  manifest: PublicationManifest,
  markdownRelativePath: string,
): readonly string[] => {
  if (
    isAbsolute(markdownRelativePath) ||
    markdownRelativePath.includes('\\') ||
    posix.normalize(markdownRelativePath) !== markdownRelativePath
  ) {
    throw new PublicationCandidateError('unsafe_candidate', 'O caminho do Markdown é inválido.');
  }
  const lawRoot = `leis/${manifest.law.directoryName}`;
  const prefix = `${lawRoot}/`;
  if (!markdownRelativePath.startsWith(prefix)) {
    throw new PublicationCandidateError(
      'unsafe_candidate',
      'O Markdown não pertence à única lei do manifesto.',
    );
  }
  const markdownName = markdownRelativePath.slice(prefix.length);
  if (!MARKDOWN_FILE.test(markdownName) || markdownName === 'UPDATE.md') {
    throw new PublicationCandidateError(
      'unsafe_candidate',
      'A publicação exige exatamente um Markdown canônico na raiz da lei.',
    );
  }
  return Object.freeze(
    [
      markdownRelativePath,
      `${lawRoot}/UPDATE.md`,
      publicationIdentifiedAstRelativePath(
        manifest.law.directoryName,
        manifest.target.publicationNumber,
        manifest.target.version,
      ),
      publicationManifestRelativePath(
        manifest.law.directoryName,
        manifest.target.publicationNumber,
        manifest.target.version,
      ),
      ...manifest.sourceSnapshots.map((snapshot) =>
        publicationSourceSnapshotRelativePath(
          manifest.law.directoryName,
          snapshot.sourceArtifactSha256,
        ),
      ),
    ].sort(),
  );
};

const assertArtifactFiles = async (root: string, paths: readonly string[]): Promise<void> => {
  for (const path of paths) {
    const absolute = posix.join(root.replaceAll('\\', '/'), path);
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new PublicationCandidateError(
        'unsafe_candidate',
        'A publicação contém symlink ou artefato que não é arquivo regular.',
      );
    }
    const resolved = await realpath(absolute);
    if (!isInside(root, resolved)) {
      throw new PublicationCandidateError('unsafe_candidate', 'Um artefato escapa do repositório.');
    }
  }
};

const parseNulPaths = (value: string): readonly string[] =>
  value
    .split('\0')
    .filter((path) => path.length > 0)
    .sort();

const assertExactPaths = (actual: readonly string[], expected: readonly string[]): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new PublicationCandidateError(
      'unsafe_candidate',
      'O release candidate contém paths ausentes ou não autorizados.',
    );
  }
};

const pathExistsAtCommit = async (
  runner: GitCommandRunner,
  root: string,
  commitSha: string,
  path: string,
): Promise<boolean> => {
  const result = await runner(['cat-file', '-e', `${commitSha}:${path}`], { cwd: root });
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1 || result.exitCode === 128) return false;
  throw new PublicationCandidateError(
    'unsafe_candidate',
    'Não foi possível verificar os artefatos existentes na base aprovada.',
  );
};

const deriveChangedArtifactPaths = async (options: {
  runner: GitCommandRunner;
  root: string;
  baseSha: string;
  manifest: PublicationManifest;
  artifactRelativePaths: readonly string[];
}): Promise<readonly string[]> => {
  const snapshotPaths = new Set(
    options.manifest.sourceSnapshots.map((snapshot) =>
      publicationSourceSnapshotRelativePath(
        options.manifest.law.directoryName,
        snapshot.sourceArtifactSha256,
      ),
    ),
  );
  const changedPaths = await Promise.all(
    options.artifactRelativePaths.map(async (path) =>
      snapshotPaths.has(path) &&
      (await pathExistsAtCommit(options.runner, options.root, options.baseSha, path))
        ? null
        : path,
    ),
  );
  return Object.freeze(changedPaths.filter((path): path is string => path !== null).sort());
};

const resolveCandidateRef = async (
  runner: GitCommandRunner,
  root: string,
  candidateBranch: string,
): Promise<string | null> => {
  const result = await runner(['show-ref', '--verify', '--hash', `refs/heads/${candidateBranch}`], {
    cwd: root,
  });
  if (result.exitCode !== 0) return null;
  const sha = result.stdout.trim();
  if (!GIT_SHA.test(sha)) {
    throw new PublicationCandidateError(
      'unsafe_candidate',
      'O branch candidato possui SHA inválido.',
    );
  }
  return sha;
};

const assertCandidateCommit = async (options: {
  runner: GitCommandRunner;
  root: string;
  commitSha: string;
  expectedBaseSha: string;
  artifactRelativePaths: readonly string[];
  changedArtifactRelativePaths: readonly string[];
  manifestRelativePath: string;
  manifestCanonical: string;
}): Promise<void> => {
  const parent = (
    await runChecked(
      options.runner,
      options.root,
      ['rev-parse', `${options.commitSha}^`],
      'unsafe_candidate',
    )
  ).trim();
  if (parent !== options.expectedBaseSha) {
    throw new PublicationCandidateError(
      'git_base_conflict',
      'O commit candidato não parte da base aprovada.',
    );
  }
  const changed = parseNulPaths(
    await runChecked(
      options.runner,
      options.root,
      ['diff', '--name-only', '-z', options.expectedBaseSha, options.commitSha, '--'],
      'unsafe_candidate',
    ),
  );
  assertExactPaths(changed, options.changedArtifactRelativePaths);

  const tree = await runChecked(
    options.runner,
    options.root,
    ['ls-tree', '-z', options.commitSha, '--', ...options.artifactRelativePaths],
    'unsafe_candidate',
  );
  const entries = tree.split('\0').filter((entry) => entry.length > 0);
  if (
    entries.length !== options.artifactRelativePaths.length ||
    entries.some((entry) => !entry.startsWith('100644 blob '))
  ) {
    throw new PublicationCandidateError(
      'unsafe_candidate',
      'Os artefatos do candidato devem ser arquivos Git regulares e não executáveis.',
    );
  }
  const committedManifest = await runChecked(
    options.runner,
    options.root,
    ['show', `${options.commitSha}:${options.manifestRelativePath}`],
    'unsafe_candidate',
  );
  if (committedManifest !== options.manifestCanonical) {
    throw new PublicationCandidateError(
      'unsafe_candidate',
      'Os bytes do manifesto commitado diferem dos bytes aprovados.',
    );
  }
};

const createInitialJournal = (options: {
  manifest: PublicationManifest;
  manifestCanonical: string;
  approval: PublicationApproval;
  artifactRelativePaths: readonly string[];
  now: () => Date;
  generateUuid: () => string;
}): PublicationJournal =>
  publicationJournalSchema.parse({
    schemaVersion: 1,
    publicationId: options.manifest.publicationId,
    idempotencyKey: options.manifest.idempotencyKey,
    lawId: options.manifest.law.lawId,
    targetVersion: options.manifest.target.version,
    targetPublicationNumber: options.manifest.target.publicationNumber,
    manifestCanonical: options.manifestCanonical,
    manifestDigest: calculatePublicationManifestDigest(options.manifest),
    approval: options.approval,
    artifactRelativePaths: options.artifactRelativePaths,
    candidateBranch: `releases/${options.manifest.publicationId}`,
    events: [
      {
        eventId: options.generateUuid(),
        status: 'prepared',
        occurredAt: options.now().toISOString(),
      },
    ],
  });

export interface CommitAndPushCandidateInput {
  readonly repositoryRoot: string;
  readonly storageRoot: string;
  readonly manifestCanonical: string;
  readonly approval: unknown;
  readonly markdownRelativePath: string;
}

export const commitAndPushPublicationCandidate = async (
  input: CommitAndPushCandidateInput,
  dependencies: {
    runner?: GitCommandRunner;
    journalStore?: PublicationJournalStore;
    now?: () => Date;
    generateUuid?: () => string;
  } = {},
): Promise<PublicationJournal> => {
  const runner = dependencies.runner ?? runGitCommand;
  const now = dependencies.now ?? (() => new Date());
  const generateUuid = dependencies.generateUuid ?? randomUUID;
  const root = await prepareRepository(input.repositoryRoot, runner);
  const manifest = parseCanonicalPublicationManifest(input.manifestCanonical);
  const approval = publicationApprovalSchema.parse(input.approval);
  const artifactRelativePaths = validateArtifactPaths(manifest, input.markdownRelativePath);
  await assertArtifactFiles(root, artifactRelativePaths);
  const changedArtifactRelativePaths = await deriveChangedArtifactPaths({
    runner,
    root,
    baseSha: manifest.expectedBase.gitCommitSha,
    manifest,
    artifactRelativePaths,
  });
  const manifestRelativePath = publicationManifestRelativePath(
    manifest.law.directoryName,
    manifest.target.publicationNumber,
    manifest.target.version,
  );
  const manifestOnDisk = await readFile(posix.join(root, manifestRelativePath), 'utf8');
  if (manifestOnDisk !== input.manifestCanonical) {
    throw new PublicationCandidateError(
      'unsafe_candidate',
      'O manifesto no repositório difere dos bytes canônicos aprovados.',
    );
  }

  const store = dependencies.journalStore ?? createPublicationJournalStore(input.storageRoot);
  const initialJournal = createInitialJournal({
    manifest,
    manifestCanonical: input.manifestCanonical,
    approval,
    artifactRelativePaths,
    now,
    generateUuid,
  });
  let journal = (await store.load(manifest.publicationId)) ?? (await store.create(initialJournal));
  if (
    journal.manifestCanonical !== initialJournal.manifestCanonical ||
    journal.approval.approvalId !== initialJournal.approval.approvalId ||
    JSON.stringify(journal.artifactRelativePaths) !== JSON.stringify(artifactRelativePaths)
  ) {
    throw new PublicationCandidateError(
      'unsafe_candidate',
      'O retry não corresponde ao manifesto, aprovação e paths persistidos.',
    );
  }

  let proven = getProvenPublicationState(journal);
  if (proven.status === 'pushed') return journal;

  const appendFailure = async (
    failureCode: 'git_base_conflict' | 'git_commit_failed' | 'git_push_failed' | 'unsafe_candidate',
  ): Promise<void> => {
    journal = await store.append(manifest.publicationId, {
      eventId: generateUuid(),
      status: 'failed',
      occurredAt: now().toISOString(),
      resumeFromStatus: proven.status,
      failureCode,
      gitCommitSha: proven.gitCommitSha,
    });
  };

  if (proven.status === 'prepared') {
    try {
      let candidateSha = await resolveCandidateRef(runner, root, journal.candidateBranch);
      if (candidateSha === null) {
        const head = (
          await runChecked(runner, root, ['rev-parse', 'HEAD'], 'git_base_conflict')
        ).trim();
        if (head !== manifest.expectedBase.gitCommitSha) {
          throw new PublicationCandidateError(
            'git_base_conflict',
            'A base Git mudou depois da aprovação.',
          );
        }
        await runChecked(
          runner,
          root,
          ['switch', '--create', journal.candidateBranch, manifest.expectedBase.gitCommitSha],
          'git_commit_failed',
        );
        candidateSha = manifest.expectedBase.gitCommitSha;
      } else {
        await runChecked(runner, root, ['switch', journal.candidateBranch], 'git_commit_failed');
      }

      if (candidateSha === manifest.expectedBase.gitCommitSha) {
        await runChecked(
          runner,
          root,
          ['add', '--', ...artifactRelativePaths],
          'git_commit_failed',
        );
        const staged = parseNulPaths(
          await runChecked(
            runner,
            root,
            ['diff', '--cached', '--name-only', '-z', '--'],
            'git_commit_failed',
          ),
        );
        assertExactPaths(staged, changedArtifactRelativePaths);
        await runChecked(
          runner,
          root,
          ['commit', '--message', `release: ${manifest.publicationId} v${manifest.target.version}`],
          'git_commit_failed',
        );
        candidateSha = (
          await runChecked(runner, root, ['rev-parse', 'HEAD'], 'git_commit_failed')
        ).trim();
      }
      if (!GIT_SHA.test(candidateSha)) {
        throw new PublicationCandidateError(
          'unsafe_candidate',
          'O commit candidato possui SHA inválido.',
        );
      }
      await assertCandidateCommit({
        runner,
        root,
        commitSha: candidateSha,
        expectedBaseSha: manifest.expectedBase.gitCommitSha,
        artifactRelativePaths,
        changedArtifactRelativePaths,
        manifestRelativePath,
        manifestCanonical: input.manifestCanonical,
      });
      journal = await store.append(manifest.publicationId, {
        eventId: generateUuid(),
        status: 'committed_local',
        occurredAt: now().toISOString(),
        gitCommitSha: candidateSha,
      });
      proven = getProvenPublicationState(journal);
    } catch (error) {
      const code =
        error instanceof PublicationCandidateError ? error.code : ('git_commit_failed' as const);
      const failureCode = code === 'unsafe_repository' ? 'unsafe_candidate' : code;
      await appendFailure(failureCode);
      throw error;
    }
  }

  if (proven.status !== 'committed_local' || proven.gitCommitSha === null) {
    throw new PublicationCandidateError('unsafe_candidate', 'Não existe commit local comprovado.');
  }
  try {
    const branchSha = await resolveCandidateRef(runner, root, journal.candidateBranch);
    if (branchSha !== proven.gitCommitSha) {
      throw new PublicationCandidateError(
        'unsafe_candidate',
        'O branch candidato local não aponta para o SHA persistido.',
      );
    }
    await assertCandidateCommit({
      runner,
      root,
      commitSha: proven.gitCommitSha,
      expectedBaseSha: manifest.expectedBase.gitCommitSha,
      artifactRelativePaths,
      changedArtifactRelativePaths,
      manifestRelativePath,
      manifestCanonical: input.manifestCanonical,
    });
    await runChecked(
      runner,
      root,
      [
        'push',
        '--porcelain',
        'origin',
        `${proven.gitCommitSha}:refs/heads/${journal.candidateBranch}`,
      ],
      'git_push_failed',
    );
    journal = await store.append(manifest.publicationId, {
      eventId: generateUuid(),
      status: 'pushed',
      occurredAt: now().toISOString(),
      gitCommitSha: proven.gitCommitSha,
    });
    return journal;
  } catch (error) {
    await appendFailure(
      error instanceof PublicationCandidateError && error.code === 'unsafe_candidate'
        ? 'unsafe_candidate'
        : 'git_push_failed',
    );
    throw error;
  }
};
