import { Buffer } from 'node:buffer';

import {
  publicationGitShaSchema,
  publicationUuidSchema,
} from '../../../src/shared/publication/manifest.js';
import { PublisherGitError, type PublisherGitRepository } from './git-repository.js';

const REPOSITORY_NAME = /^[A-Za-z0-9_.-]{1,100}$/u;
const OWNER_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const MAX_BLOB_BYTES = 64 * 1024 * 1024;
const API_TIMEOUT_MS = 20_000;

type GitHubTreeEntry = Readonly<{
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}>;

export class PublisherGitHubError extends PublisherGitError {}

const decodeBase64 = (value: string): Uint8Array => {
  return new Uint8Array(Buffer.from(value, 'base64'));
};

export const createPublisherGitHubRepository = (options: {
  owner: string;
  repository: string;
  token: string;
  canonicalBranch?: string;
  fetchImplementation?: typeof fetch;
}): PublisherGitRepository => {
  if (!OWNER_NAME.test(options.owner) || !REPOSITORY_NAME.test(options.repository)) {
    throw new PublisherGitHubError('unsafe_repository', 'O repositório GitHub é inválido.');
  }
  if (options.token.length < 20 || options.token.length > 4_096) {
    throw new PublisherGitHubError('unsafe_repository', 'A credencial GitHub é inválida.');
  }
  const canonicalBranch = options.canonicalBranch ?? 'main';
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(canonicalBranch)) {
    throw new PublisherGitHubError('unsafe_repository', 'O branch canônico é inválido.');
  }
  const request = options.fetchImplementation ?? fetch;
  const baseUrl = `https://api.github.com/repos/${options.owner}/${options.repository}`;

  const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('Authorization', `Bearer ${options.token}`);
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    headers.set('User-Agent', 'lex-editor-publisher');
    const response = await request(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers,
    });
    if (!response.ok) {
      throw new PublisherGitHubError(
        response.status === 409 || response.status === 422
          ? 'promotion_conflict'
          : 'git_read_failed',
        'A operação segura no repositório remoto falhou.',
      );
    }
    return (await response.json()) as T;
  };

  const getRefSha = async (ref: string): Promise<string> => {
    const result = await api<{ object: { sha: string } }>(`/git/ref/${encodeURIComponent(ref)}`);
    return publicationGitShaSchema.parse(result.object.sha);
  };

  const getCommit = (sha: string) =>
    api<{ sha: string; tree: { sha: string }; parents: readonly { sha: string }[] }>(
      `/git/commits/${publicationGitShaSchema.parse(sha)}`,
    );

  const getTree = async (commitSha: string): Promise<readonly GitHubTreeEntry[]> => {
    const commit = await getCommit(commitSha);
    const result = await api<{
      truncated: boolean;
      tree: readonly GitHubTreeEntry[];
    }>(`/git/trees/${publicationGitShaSchema.parse(commit.tree.sha)}?recursive=1`);
    if (result.truncated) {
      throw new PublisherGitHubError(
        'git_read_failed',
        'A árvore Git excede o limite seguro de validação.',
      );
    }
    return result.tree;
  };

  return {
    async fetchCandidate(publicationId) {
      const id = publicationUuidSchema.parse(publicationId);
      return getRefSha(`heads/releases/${id}`);
    },
    getCanonicalSha() {
      return getRefSha(`heads/${canonicalBranch}`);
    },
    async getParentSha(commitSha) {
      const commit = await getCommit(commitSha);
      if (commit.parents.length !== 1 || commit.parents[0] === undefined) {
        throw new PublisherGitHubError(
          'git_read_failed',
          'O candidato deve possuir exatamente um commit-base.',
        );
      }
      return publicationGitShaSchema.parse(commit.parents[0].sha);
    },
    async listChangedPaths(baseSha, commitSha) {
      const [baseTree, candidateTree] = await Promise.all([getTree(baseSha), getTree(commitSha)]);
      const base = new Map(
        baseTree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry.sha]),
      );
      const candidate = new Map(
        candidateTree
          .filter((entry) => entry.type === 'blob')
          .map((entry) => [entry.path, entry.sha]),
      );
      return [...new Set([...base.keys(), ...candidate.keys()])]
        .filter((path) => base.get(path) !== candidate.get(path))
        .sort();
    },
    async listTreeEntries(commitSha, paths) {
      const requested = new Set(paths);
      return (await getTree(commitSha))
        .filter((entry) => entry.type === 'blob' && requested.has(entry.path))
        .map((entry) => ({ mode: entry.mode, path: entry.path }))
        .sort((left, right) => left.path.localeCompare(right.path));
    },
    async readBlob(commitSha, path) {
      if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
        throw new PublisherGitHubError('git_read_failed', 'O path Git solicitado é inválido.');
      }
      const entry = (await getTree(commitSha)).find(
        (candidate) => candidate.type === 'blob' && candidate.path === path,
      );
      if (entry === undefined) {
        throw new PublisherGitHubError('git_read_failed', 'O artefato Git não existe.');
      }
      const blob = await api<{ encoding: string; content: string; size: number }>(
        `/git/blobs/${publicationGitShaSchema.parse(entry.sha)}`,
      );
      if (blob.encoding !== 'base64' || blob.size > MAX_BLOB_BYTES) {
        throw new PublisherGitHubError('git_read_failed', 'O blob Git excede o limite seguro.');
      }
      const bytes = decodeBase64(blob.content.replaceAll('\n', ''));
      if (bytes.byteLength !== blob.size) {
        throw new PublisherGitHubError('git_read_failed', 'O blob Git retornado é inválido.');
      }
      return bytes;
    },
    async promoteExactCommit(commitSha, expectedBaseSha) {
      const commit = publicationGitShaSchema.parse(commitSha);
      const base = publicationGitShaSchema.parse(expectedBaseSha);
      if ((await getRefSha(`heads/${canonicalBranch}`)) !== base) {
        throw new PublisherGitHubError(
          'promotion_conflict',
          'A base canônica mudou antes da promoção.',
        );
      }
      await api(`/git/refs/heads/${encodeURIComponent(canonicalBranch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit, force: false }),
      });
    },
  };
};
