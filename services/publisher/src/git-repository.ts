import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  publicationGitShaSchema,
  publicationUuidSchema,
} from '../../../src/shared/publication/manifest.js';
import type { PublisherGitReader } from './validation.js';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

const gitEnvironment = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };
  for (const name of [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SSH_AUTH_SOCK',
    'GIT_ASKPASS',
    'SSH_ASKPASS',
    'XDG_CONFIG_HOME',
  ] as const) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
};

export class PublisherGitError extends Error {
  constructor(
    readonly code: 'unsafe_repository' | 'git_read_failed' | 'promotion_conflict',
    message: string,
  ) {
    super(message);
  }
}

const execGit = async (
  root: string,
  args: readonly string[],
  encoding: 'utf8' | 'buffer',
): Promise<string | Uint8Array> => {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd: root,
      encoding,
      env: gitEnvironment(),
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      shell: false,
      windowsHide: true,
    });
    return encoding === 'buffer' ? new Uint8Array(result.stdout as Buffer) : String(result.stdout);
  } catch {
    throw new PublisherGitError('git_read_failed', 'A leitura segura do repositório falhou.');
  }
};

const gitText = async (root: string, args: readonly string[]): Promise<string> =>
  (await execGit(root, args, 'utf8')) as string;

const gitBytes = async (root: string, args: readonly string[]): Promise<Uint8Array> =>
  (await execGit(root, args, 'buffer')) as Uint8Array;

const parseNulPaths = (output: string): readonly string[] =>
  output
    .split('\0')
    .filter((path) => path.length > 0)
    .sort();

export interface PublisherGitRepository extends PublisherGitReader {
  promoteExactCommit(commitSha: string, expectedBaseSha: string): Promise<void>;
}

export const createPublisherGitRepository = async (options: {
  repositoryRoot: string;
  remoteName?: string;
  canonicalBranch?: string;
}): Promise<PublisherGitRepository> => {
  const info = await lstat(options.repositoryRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PublisherGitError('unsafe_repository', 'A raiz Git do publisher não é segura.');
  }
  const root = await realpath(options.repositoryRoot);
  await gitText(root, ['rev-parse', '--git-dir']);
  const remote = options.remoteName ?? 'origin';
  const canonicalBranch = options.canonicalBranch ?? 'main';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(remote)) {
    throw new PublisherGitError('unsafe_repository', 'O remote Git configurado é inválido.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(canonicalBranch)) {
    throw new PublisherGitError('unsafe_repository', 'O branch canônico configurado é inválido.');
  }

  return {
    async fetchCandidate(publicationId) {
      const id = publicationUuidSchema.parse(publicationId);
      const remoteRef = `refs/heads/releases/${id}`;
      const localRef = `refs/publisher/candidates/${id}`;
      await gitText(root, ['fetch', '--no-tags', remote, `${remoteRef}:${localRef}`]);
      return publicationGitShaSchema.parse(
        (await gitText(root, ['rev-parse', '--verify', localRef])).trim(),
      );
    },

    async getCanonicalSha() {
      const output = (
        await gitText(root, ['ls-remote', '--heads', remote, `refs/heads/${canonicalBranch}`])
      ).trim();
      const [sha, ref, extra] = output.split(/\s+/u);
      if (extra !== undefined || ref !== `refs/heads/${canonicalBranch}`) {
        throw new PublisherGitError('git_read_failed', 'A referência canônica remota é ambígua.');
      }
      return publicationGitShaSchema.parse(sha);
    },

    async getParentSha(commitSha) {
      const sha = publicationGitShaSchema.parse(commitSha);
      return publicationGitShaSchema.parse((await gitText(root, ['rev-parse', `${sha}^`])).trim());
    },

    async listChangedPaths(baseSha, commitSha) {
      const base = publicationGitShaSchema.parse(baseSha);
      const commit = publicationGitShaSchema.parse(commitSha);
      return parseNulPaths(
        await gitText(root, ['diff', '--name-only', '--no-ext-diff', '-z', base, commit, '--']),
      );
    },

    async listTreeEntries(commitSha, paths) {
      const commit = publicationGitShaSchema.parse(commitSha);
      const output = await gitText(root, ['ls-tree', '-z', commit, '--', ...paths]);
      return output
        .split('\0')
        .filter((entry) => entry.length > 0)
        .map((entry) => {
          const match = /^(\d{6}) [a-z]+ [0-9a-f]+\t(.+)$/u.exec(entry);
          if (match?.[1] === undefined || match[2] === undefined) {
            throw new PublisherGitError(
              'git_read_failed',
              'A árvore Git retornou entrada inválida.',
            );
          }
          return { mode: match[1], path: match[2] };
        });
    },

    async readBlob(commitSha, path) {
      const commit = publicationGitShaSchema.parse(commitSha);
      if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
        throw new PublisherGitError('git_read_failed', 'O path Git solicitado é inválido.');
      }
      return gitBytes(root, ['show', `${commit}:${path}`]);
    },

    async promoteExactCommit(commitSha, expectedBaseSha) {
      const commit = publicationGitShaSchema.parse(commitSha);
      const base = publicationGitShaSchema.parse(expectedBaseSha);
      try {
        await gitText(root, [
          '-c',
          `remote.${remote}.mirror=false`,
          'push',
          '--porcelain',
          `--force-with-lease=refs/heads/${canonicalBranch}:${base}`,
          remote,
          `${commit}:refs/heads/${canonicalBranch}`,
        ]);
      } catch {
        throw new PublisherGitError(
          'promotion_conflict',
          'A promoção foi recusada porque a base canônica mudou.',
        );
      }
    },
  };
};
