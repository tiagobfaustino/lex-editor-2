import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import {
  calculateRevisionHash,
  contarBlockIds,
  deriveStructuredChanges,
  formatar,
  generateUpdateMarkdown,
  reconciliar,
  registrarPublicacao,
  slugifyVincuLexSegment,
  validarIdentifiedNormaAst,
  validarMarkdownCanonico,
  type IdentifiedNormaAST,
  type SourceType,
  type SourceRole,
  type SourceVariant,
} from '@lex-editor/legal-domain';
import {
  createPublicationHistoryService,
  type StoredPublicationVersion,
} from '../../../services/publisher/src/history.js';
import {
  PublicationContextSchema,
  PublicationHistoryResponseSchema,
} from '../../../services/desktop-gateway/src/contracts.js';
import {
  PublicationAttemptDtoSchema,
  PublicationConfirmationDtoSchema,
  PublicationDiffDtoSchema,
  type PublicationAttemptDto,
  type PublicationChangeSummaryDto,
} from '../../shared/ipc/publication.js';
import { LegislativeUpdateDetailDtoSchema } from '../../shared/ipc/updates.js';
import { publicationApprovalSchema } from '../../shared/publication/approval.js';
import {
  calculatePublicationManifestDigest,
  createPublicationIdentifiers,
  deriveNextPublicationNumber,
  deriveNextPublicationVersion,
  parseCanonicalPublicationManifest,
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  publicationSourceSnapshotRelativePath,
  serializeCanonicalJson,
  serializePublicationManifest,
  type PublicationManifest,
} from './manifest.js';
import { commitAndPushPublicationCandidate, readGitBlob, runGitCommand } from './candidate-git.js';
import { createPublicationJournalStore, getProvenPublicationState } from './journal.js';
import type {
  PublicationDesktopOperations,
  PublicationProjectAuthorizer,
  PublicationProjectRevision,
} from './desktop-service.js';

const MAX_ARTIFACT_BYTES = 40 * 1024 * 1024;
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export type PublicationSnapshot = Readonly<{
  ast: IdentifiedNormaAST;
  revisionHash: string;
  snapshots: readonly Readonly<{
    sourceType: SourceType;
    sourceRole: SourceRole;
    sourceVariant: SourceVariant;
    sourceUrl?: string | undefined;
    finalUrl?: string | undefined;
    sourceArtifactSha256: string;
    capturedAt: string;
    bytes: Uint8Array;
  }>[];
}>;
export type PublicationProjects = PublicationProjectAuthorizer &
  Readonly<{
    getPublicationSnapshot(projectId: string): Promise<PublicationSnapshot>;
    getProjectAst?(projectId: string): IdentifiedNormaAST | null;
  }>;
export type PublicationRemote = Readonly<{
  getActor(): Readonly<{ userId: string; role: string }> | null;
  request<T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<T>;
}>;
const publisherAttemptSchema = z.strictObject({
  publicationId: z.uuid(),
  candidateSha: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u),
  manifestDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  publicationAttemptStatus: z.enum(['pushed', 'syncing', 'published', 'failed']),
  resumeFromStatus: z.enum(['pushed', 'syncing']).nullable(),
  publishedVersionId: z.uuid().nullable(),
});
const draftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  revisionHash: z.string().regex(/^[0-9a-f]{64}$/u),
  userId: z.uuid(),
  updateId: z.uuid().nullable(),
  candidateArtifactId: z.uuid().nullable(),
  projectRevisionHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable(),
  manifestCanonical: z.string().max(256 * 1024),
  markdownRelativePath: z.string().min(1).max(240),
  confirmation: PublicationConfirmationDtoSchema,
});

const changeSummary = (
  changes: PublicationManifest['changelog']['changes'],
): PublicationChangeSummaryDto => {
  const items = [
    ...changes.included.map((v) => ({
      changeKind: 'included' as const,
      blockId: v.blockId,
      destinationBlockId: null,
      description: v.description,
    })),
    ...changes.amended.map((v) => ({
      changeKind: 'amended' as const,
      blockId: v.blockId,
      destinationBlockId: null,
      description: v.description,
    })),
    ...changes.revoked.map((v) => ({
      changeKind: 'revoked' as const,
      blockId: v.blockId,
      destinationBlockId: null,
      description: v.description,
    })),
    ...changes.renumbered.map((v) => ({
      changeKind: 'renumbered' as const,
      blockId: v.from,
      destinationBlockId: v.to,
      description: v.description,
    })),
  ];
  let encodedBytes = 0;
  const boundedItems = [];
  for (const item of items) {
    encodedBytes += Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (encodedBytes > 40 * 1024 || boundedItems.length >= 2000) break;
    boundedItems.push(item);
  }
  return {
    included: changes.included.length,
    amended: changes.amended.length,
    revoked: changes.revoked.length,
    renumbered: changes.renumbered.length,
    items: boundedItems,
    truncated: boundedItems.length < items.length,
  };
};

export const createPublicationOperations = (options: {
  repositoryRoot: string;
  storageRoot: string;
  canonicalBranch: string;
  projects: PublicationProjects;
  remote: PublicationRemote;
  now?: () => Date;
}): PublicationDesktopOperations &
  Readonly<{
    prepareSnapshot(
      projectId: string,
      snapshot: PublicationSnapshot,
      sourceSummary: string,
      update?: Readonly<{ updateId: string; candidateArtifactId: string }>,
    ): Promise<z.infer<typeof draftSchema>['confirmation']>;
    findPreparedUpdate(
      updateId: string,
      candidateArtifactId: string,
      revisionHash: string,
      baseVersionId: string,
    ): Promise<z.infer<typeof draftSchema>['confirmation'] | null>;
    getPreparedConfirmation(
      publicationId: string,
    ): Promise<z.infer<typeof draftSchema>['confirmation']>;
    recordPreparedApproval(publicationId: string): Promise<void>;
    getPreparedProof(
      publicationId: string,
    ): Promise<Readonly<{ manifestCanonical: string; identifiedAstCanonical: string }>>;
  }> => {
  const now = options.now ?? (() => new Date());
  const workspaces = join(options.storageRoot, 'publication-workspaces');
  const drafts = join(options.storageRoot, 'publication-drafts');
  const journalStore = createPublicationJournalStore(options.storageRoot);
  const locks = new Map<
    string,
    Readonly<{ userId: string; promise: Promise<PublicationAttemptDto> }>
  >();
  const requireActor = (editor = false) => {
    const actor = options.remote.getActor();
    if (actor === null || (editor && actor.role !== 'editor_juridico'))
      throw new Error('NOT_ALLOWED');
    return actor;
  };
  const inside = (root: string, child: string) => {
    const rel = relative(root, child);
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
  };
  const directory = async (root: string, path: string): Promise<void> => {
    if (!inside(root, path)) throw new Error('UNSAFE_PUBLICATION_PATH');
    await mkdir(root, { recursive: true, mode: 0o700 });
    let current = root;
    for (const part of relative(root, path).split(sep).filter(Boolean)) {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('UNSAFE_PUBLICATION_PATH');
      current = join(current, part);
      await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
      });
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('UNSAFE_PUBLICATION_PATH');
  };
  const readBytes = async (path: string): Promise<Buffer> => {
    if ((await realpath(path)) !== path) throw new Error('UNSAFE_PUBLICATION_PATH');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_ARTIFACT_BYTES)
        throw new Error('INVALID_PUBLICATION_ARTIFACT');
      return await file.readFile();
    } finally {
      await file.close();
    }
  };
  const readSafe = async (path: string): Promise<string> =>
    (await readBytes(path)).toString('utf8');
  const writeSafe = async (
    root: string,
    path: string,
    value: string | Uint8Array,
    immutable = false,
  ): Promise<void> => {
    await directory(root, dirname(path));
    if (immutable) {
      try {
        const existing = await readBytes(path);
        if (!existing.equals(Buffer.from(value))) throw new Error('IMMUTABLE_PUBLICATION_ARTIFACT');
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
    } else {
      const info = await lstat(path).catch((error: unknown) => {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        throw error;
      });
      if (info !== null && (info.isSymbolicLink() || !info.isFile()))
        throw new Error('UNSAFE_PUBLICATION_PATH');
    }
    const temporary = `${path}.${createPublicationIdentifiers().publicationId}.tmp`;
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(value);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const parent = await open(dirname(path), constants.O_RDONLY);
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  };
  const git = async (cwd: string, args: readonly string[]): Promise<string> => {
    const result = await runGitCommand(args, { cwd, maxOutputBytes: MAX_ARTIFACT_BYTES });
    if (result.exitCode !== 0) throw new Error('PUBLICATION_GIT_FAILED');
    return result.stdout;
  };
  const repository = async (): Promise<string> => {
    const info = await lstat(options.repositoryRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('UNSAFE_REPOSITORY');
    const root = await realpath(options.repositoryRoot);
    if ((await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim())) !== root)
      throw new Error('UNSAFE_REPOSITORY');
    return root;
  };
  let fetching: Promise<string> | null = null;
  const fetchCanonical = async (root: string): Promise<string> => {
    if (fetching !== null) return fetching;
    const operation = (async () => {
      await git(root, ['fetch', 'origin', `refs/heads/${options.canonicalBranch}`]);
      return (await git(root, ['rev-parse', 'FETCH_HEAD'])).trim();
    })().finally(() => {
      fetching = null;
    });
    fetching = operation;
    return operation;
  };
  const readBlob = async (root: string, commit: string, path: string): Promise<string> => {
    const tree = await git(root, ['ls-tree', commit, '--', path]);
    if (!tree.startsWith('100644 blob ') || tree.trim().split('\n').length !== 1)
      throw new Error('INVALID_PUBLICATION_ARTIFACT');
    return git(root, ['show', `${commit}:${path}`]);
  };
  const manifests = async (
    root: string,
    commit: string,
    lawId: string,
  ): Promise<PublicationManifest[]> => {
    const paths = (await git(root, ['ls-tree', '--name-only', '-r', commit, '--', 'leis/']))
      .split('\n')
      .filter((p) =>
        /^leis\/[a-z0-9]+(?:-[a-z0-9]+)*\/\.vinculex\/releases\/\d{6}-\d+\.\d+\.\d+\.json$/u.test(
          p,
        ),
      );
    if (paths.length > 10000) throw new Error('PUBLICATION_HISTORY_TOO_LARGE');
    const result: PublicationManifest[] = [];
    for (const path of paths) {
      const manifest = parseCanonicalPublicationManifest(await readBlob(root, commit, path));
      if (manifest.law.lawId === lawId) result.push(manifest);
    }
    return result.sort((a, b) => b.target.publicationNumber - a.target.publicationNumber);
  };
  const readAst = async (
    root: string,
    commit: string,
    manifest: PublicationManifest,
  ): Promise<IdentifiedNormaAST> => {
    const text = await readBlob(
      root,
      commit,
      publicationIdentifiedAstRelativePath(
        manifest.law.directoryName,
        manifest.target.publicationNumber,
        manifest.target.version,
      ),
    );
    if (sha256(text) !== manifest.artifacts.identifiedAstSha256)
      throw new Error('INVALID_PUBLICATION_ARTIFACT');
    const result = validarIdentifiedNormaAst(JSON.parse(text) as unknown);
    if (!result.ok || serializeCanonicalJson(result.valor) !== text)
      throw new Error('INVALID_PUBLICATION_ARTIFACT');
    return result.valor;
  };
  const loadDraft = async (publicationId: string) => {
    z.uuid().parse(publicationId);
    const draft = draftSchema.parse(
      JSON.parse(await readSafe(join(drafts, `${publicationId}.json`))) as unknown,
    );
    const manifest = parseCanonicalPublicationManifest(draft.manifestCanonical);
    if (
      manifest.publicationId !== publicationId ||
      draft.confirmation.publicationId !== publicationId ||
      draft.userId !== manifest.approvedBy.userId ||
      draft.confirmation.revisionHash !== draft.revisionHash ||
      draft.confirmation.projectId !== draft.projectId ||
      draft.confirmation.lawId !== manifest.law.lawId ||
      draft.confirmation.version !== manifest.target.version ||
      draft.confirmation.publicationNumber !== manifest.target.publicationNumber ||
      draft.confirmation.publicationKind !== manifest.target.kind ||
      draft.confirmation.publicationImpact !== manifest.target.impact ||
      draft.confirmation.restoredVersionId !== manifest.target.restoredVersionId ||
      draft.confirmation.sourceSummary !== manifest.changelog.sourceSummary ||
      serializeCanonicalJson(draft.confirmation.changes) !==
        serializeCanonicalJson(changeSummary(manifest.changelog.changes))
    )
      throw new Error('INVALID_PUBLICATION_DRAFT');
    if (draft.userId !== requireActor().userId) throw new Error('NOT_ALLOWED');
    return { draft, manifest };
  };
  const contextFor = (ast: IdentifiedNormaAST) =>
    options.remote.request(
      '/publication/context',
      { tipoNorma: ast.tipoNorma, numero: ast.numero, ano: ast.ano, sigla: ast.sigla },
      PublicationContextSchema,
    );
  const projectAst = async (projectId: string) => {
    const ast = options.projects.getProjectAst?.(projectId);
    return ast ?? (await options.projects.getPublicationSnapshot(projectId)).ast;
  };
  const prepareSnapshot = async (
    projectId: string,
    snapshot: PublicationSnapshot,
    sourceSummary: string,
    update?: Readonly<{ updateId: string; candidateArtifactId: string }>,
    rollback?: Readonly<{
      restoredVersionId: string;
      restoredVersion: string;
      justification: string;
      projectRevisionHash: string;
    }>,
  ) => {
    const actor = requireActor(true);
    z.uuid().parse(projectId);
    const validation = validarIdentifiedNormaAst(snapshot.ast);
    if (
      !validation.ok ||
      calculateRevisionHash(validation.valor, (v) => sha256(v)) !== snapshot.revisionHash
    )
      throw new Error('INVALID_APPROVED_REVISION');
    const context = await contextFor(validation.valor);
    const root = await repository();
    const baseSha = await fetchCanonical(root);
    const history = await manifests(root, baseSha, context.lawId);
    const previous =
      context.current === null
        ? null
        : history.find(
            (v) =>
              v.target.publicationNumber === context.current?.publicationNumber &&
              v.target.version === context.current.version,
          );
    if (context.current !== null && previous === undefined)
      throw new Error('PUBLICATION_BASE_UNAVAILABLE');
    const previousAst =
      previous == null || context.current === null
        ? null
        : await readAst(root, context.current.gitCommitSha, previous);
    const aliases = [
      ...new Map(
        [...context.redirects, ...(validation.valor.idsDepreciados ?? [])].map((entry) => [
          `${entry.antigo}\0${entry.novo}`,
          entry,
        ]),
      ).values(),
    ].sort((a, b) => a.antigo.localeCompare(b.antigo) || a.novo.localeCompare(b.novo));
    if (rollback !== undefined && aliases.length > 0) validation.valor.idsDepreciados = aliases;
    const registry = {
      namespace: context.blockIds,
      porPosicao: {},
      aliases: rollback === undefined ? context.redirects : [],
    };
    const positional =
      previousAst === null
        ? registry
        : registrarPublicacao(
            rollback === undefined ? previousAst : validation.valor,
            validation.valor.sigla,
            registry,
          );
    const uniqueAliases = [
      ...new Map(
        positional.aliases.map((entry) => [`${entry.antigo}\0${entry.novo}`, entry]),
      ).values(),
    ];
    const reconciled = reconciliar(
      validation.valor,
      { ...positional, aliases: uniqueAliases },
      validation.valor.sigla,
    );
    const canonicalAliases = (ast: IdentifiedNormaAST) =>
      ast.idsDepreciados === undefined
        ? ast
        : {
            ...ast,
            idsDepreciados: [
              ...new Map(
                ast.idsDepreciados.map((entry) => [`${entry.antigo}\0${entry.novo}`, entry]),
              ).values(),
            ].sort((a, b) => a.antigo.localeCompare(b.antigo) || a.novo.localeCompare(b.novo)),
          };
    if (
      !reconciled.ok ||
      serializeCanonicalJson(canonicalAliases(reconciled.valor.arvore)) !==
        serializeCanonicalJson(canonicalAliases(validation.valor))
    )
      throw new Error('PUBLICATION_IDENTITY_CONFLICT');
    const changes = deriveStructuredChanges(previousAst, validation.valor);
    const impact =
      previousAst === null ||
      changes.included.length +
        changes.amended.length +
        changes.revoked.length +
        changes.renumbered.length >
        0
        ? ('normative_projection' as const)
        : ('editorial_metadata' as const);
    const version = deriveNextPublicationVersion(context.current?.version ?? null, impact);
    const publicationNumber = deriveNextPublicationNumber(
      context.current?.publicationNumber ?? null,
    );
    const ast = structuredClone(validation.valor);
    ast.versaoVinculex = version;
    ast.publicationStatus = 'approved';
    const formatted = formatar(ast);
    if (!formatted.ok || validarMarkdownCanonico(formatted.valor, ast).length > 0)
      throw new Error('INVALID_PUBLICATION_MARKDOWN');
    const identifiers = createPublicationIdentifiers();
    const instant = now().toISOString();
    const directoryName = previous?.law.directoryName ?? slugifyVincuLexSegment(ast.titulo);
    const fileName = slugifyVincuLexSegment(ast.sigla);
    const astCanonical = serializeCanonicalJson(ast);
    const changelog = {
      publicationDate: instant.slice(0, 10),
      version,
      publicationNumber,
      ...(rollback === undefined
        ? {}
        : {
            restoredVersion: rollback.restoredVersion,
            rollbackJustification: rollback.justification,
          }),
      kind:
        rollback !== undefined
          ? ('rollback' as const)
          : previousAst === null
            ? ('initial' as const)
            : update === undefined
              ? ('editorial_correction' as const)
              : ('legislative_update' as const),
      sourceSummary,
      changes,
    };
    const updateMarkdown = generateUpdateMarkdown([changelog, ...history.map((h) => h.changelog)]);
    const sourceSnapshots = snapshot.snapshots.map(({ bytes, ...entry }) => {
      if (sha256(bytes) !== entry.sourceArtifactSha256)
        throw new Error('SOURCE_SNAPSHOT_HASH_MISMATCH');
      return entry;
    });
    const manifest = parseCanonicalPublicationManifest(
      serializePublicationManifest({
        schemaVersion: 1,
        ...identifiers,
        law: { lawId: context.lawId, directoryName },
        target: {
          version,
          publicationNumber,
          kind: changelog.kind,
          impact,
          restoredVersionId: rollback?.restoredVersionId ?? null,
        },
        expectedBase: {
          gitCommitSha: baseSha,
          publishedVersionId: context.current?.versionId ?? null,
        },
        artifacts: {
          markdownSha256: sha256(formatted.valor),
          updateMarkdownSha256: sha256(updateMarkdown),
          identifiedAstSha256: sha256(astCanonical),
        },
        sourceSnapshots,
        approvedBy: { userId: actor.userId, role: 'editor_juridico' },
        changelog,
        preparedAt: instant,
      }),
    );
    const workspace = join(workspaces, identifiers.publicationId);
    await directory(options.storageRoot, workspaces);
    await git(root, ['worktree', 'add', '--detach', workspace, baseSha]);
    const markdownRelativePath = `leis/${directoryName}/${fileName}.md`;
    await writeSafe(workspace, join(workspace, markdownRelativePath), formatted.valor);
    await writeSafe(workspace, join(workspace, `leis/${directoryName}/UPDATE.md`), updateMarkdown);
    await writeSafe(
      workspace,
      join(
        workspace,
        publicationIdentifiedAstRelativePath(directoryName, publicationNumber, version),
      ),
      astCanonical,
      true,
    );
    await writeSafe(
      workspace,
      join(workspace, publicationManifestRelativePath(directoryName, publicationNumber, version)),
      serializePublicationManifest(manifest),
      true,
    );
    for (const artifactSnapshot of snapshot.snapshots)
      await writeSafe(
        workspace,
        join(
          workspace,
          publicationSourceSnapshotRelativePath(
            directoryName,
            artifactSnapshot.sourceArtifactSha256,
          ),
        ),
        artifactSnapshot.bytes,
        true,
      );
    const confirmation = PublicationConfirmationDtoSchema.parse({
      publicationId: identifiers.publicationId,
      projectId,
      revisionHash: snapshot.revisionHash,
      lawId: context.lawId,
      lawTitle: ast.titulo,
      sigla: ast.sigla,
      version,
      publicationNumber,
      publicationKind: changelog.kind,
      publicationImpact: impact,
      restoredVersionId: rollback?.restoredVersionId ?? null,
      restoredVersion: rollback?.restoredVersion ?? null,
      deviceCount: contarBlockIds(ast),
      artifactKinds: [
        'markdown',
        'update_markdown',
        'manifest',
        'identified_ast',
        ...snapshot.snapshots.map(() => 'source_snapshot' as const),
      ],
      sourceSummary,
      changes: changeSummary(changes),
      requiresLegalApproval: true,
    });
    const draft = draftSchema.parse({
      schemaVersion: 1,
      projectId,
      revisionHash: snapshot.revisionHash,
      userId: actor.userId,
      updateId: update?.updateId ?? null,
      candidateArtifactId: update?.candidateArtifactId ?? null,
      projectRevisionHash:
        rollback?.projectRevisionHash ?? (update === undefined ? snapshot.revisionHash : null),
      manifestCanonical: serializePublicationManifest(manifest),
      markdownRelativePath,
      confirmation,
    });
    await writeSafe(
      options.storageRoot,
      join(drafts, `${identifiers.publicationId}.json`),
      serializeCanonicalJson(draft),
      true,
    );
    return confirmation;
  };
  const toAttempt = (
    raw: z.infer<typeof publisherAttemptSchema>,
    manifest: PublicationManifest,
  ): PublicationAttemptDto => {
    if (
      raw.publicationId !== manifest.publicationId ||
      raw.manifestDigest !== calculatePublicationManifestDigest(manifest)
    )
      throw new Error('PUBLICATION_RESPONSE_MISMATCH');
    return PublicationAttemptDtoSchema.parse({
      ...raw,
      lawId: manifest.law.lawId,
      version: manifest.target.version,
      publicationNumber: manifest.target.publicationNumber,
      publicationKind: manifest.target.kind,
      updatedAt: now().toISOString(),
      retryable: raw.publicationAttemptStatus === 'failed',
      message:
        raw.publicationAttemptStatus === 'published'
          ? 'Publicação confirmada pelo serviço.'
          : 'Tentativa registrada pelo serviço.',
    });
  };
  const validatePreparedArtifacts = async (
    draft: z.infer<typeof draftSchema>,
    manifest: PublicationManifest,
  ): Promise<void> => {
    const workspace = join(workspaces, manifest.publicationId);
    const artifacts: [string, string][] = [
      [draft.markdownRelativePath, manifest.artifacts.markdownSha256],
      [`leis/${manifest.law.directoryName}/UPDATE.md`, manifest.artifacts.updateMarkdownSha256],
      [
        publicationIdentifiedAstRelativePath(
          manifest.law.directoryName,
          manifest.target.publicationNumber,
          manifest.target.version,
        ),
        manifest.artifacts.identifiedAstSha256,
      ],
      [
        publicationManifestRelativePath(
          manifest.law.directoryName,
          manifest.target.publicationNumber,
          manifest.target.version,
        ),
        sha256(draft.manifestCanonical),
      ],
      ...manifest.sourceSnapshots.map((v): [string, string] => [
        publicationSourceSnapshotRelativePath(manifest.law.directoryName, v.sourceArtifactSha256),
        v.sourceArtifactSha256,
      ]),
    ];
    const root = await realpath(workspace);
    if (root !== workspace) throw new Error('UNSAFE_PUBLICATION_PATH');
    for (const [path, digest] of artifacts) {
      const absolute = join(workspace, path);
      if (
        !inside(workspace, absolute) ||
        (await realpath(absolute)) !== absolute ||
        sha256(await readBytes(absolute)) !== digest
      )
        throw new Error('INVALID_PUBLICATION_ARTIFACT');
    }
  };
  const approveManifest = async (manifest: PublicationManifest) => {
    if (requireActor(true).userId !== manifest.approvedBy.userId) throw new Error('NOT_ALLOWED');
    const approval = await options.remote.request(
      '/publisher',
      {
        action: 'approve',
        publicationId: manifest.publicationId,
        manifestDigest: calculatePublicationManifestDigest(manifest),
      },
      publicationApprovalSchema,
    );
    if (
      approval.publicationId !== manifest.publicationId ||
      approval.userId !== manifest.approvedBy.userId ||
      approval.manifestDigest !== calculatePublicationManifestDigest(manifest)
    )
      throw new Error('PUBLICATION_APPROVAL_MISMATCH');
    return approval;
  };
  const executeOnce = async (publicationId: string): Promise<PublicationAttemptDto> => {
    const actor = requireActor(true);
    const { draft, manifest } = await loadDraft(publicationId);
    const existingJournal = await journalStore.load(publicationId);
    if (existingJournal !== null) {
      const proven = getProvenPublicationState(existingJournal);
      if (proven.status === 'pushed') {
        const attempt = await options.remote.request(
          '/publisher',
          { action: 'getAttempt', publicationId },
          publisherAttemptSchema,
        );
        if (attempt.candidateSha !== proven.gitCommitSha)
          throw new Error('PUBLICATION_RESPONSE_MISMATCH');
        if (attempt.publicationAttemptStatus === 'published') return toAttempt(attempt, manifest);
      }
    }
    if (actor.userId !== manifest.approvedBy.userId) throw new Error('NOT_ALLOWED');
    if (draft.updateId !== null) {
      const update = await options.remote.request(
        '/updates/getDetail',
        { updateId: draft.updateId },
        LegislativeUpdateDetailDtoSchema,
      );
      if (
        update.updateReviewStatus !== 'approved' ||
        update.publicationId !== publicationId ||
        update.baseVersionId !== manifest.expectedBase.publishedVersionId
      )
        throw new Error('PUBLICATION_REVISION_CONFLICT');
    } else if (draft.projectRevisionHash !== null) {
      const ast = await projectAst(draft.projectId);
      if (calculateRevisionHash(ast, sha256) !== draft.projectRevisionHash)
        throw new Error('PUBLICATION_REVISION_CONFLICT');
      if (manifest.target.kind !== 'rollback') {
        const source = await options.projects.getPublicationSnapshot(draft.projectId);
        const expected = structuredClone(source.ast);
        expected.versaoVinculex = manifest.target.version;
        expected.publicationStatus = 'approved';
        const candidate = await readSafe(
          join(
            workspaces,
            publicationId,
            publicationIdentifiedAstRelativePath(
              manifest.law.directoryName,
              manifest.target.publicationNumber,
              manifest.target.version,
            ),
          ),
        );
        if (
          source.revisionHash !== draft.revisionHash ||
          serializeCanonicalJson(expected) !== candidate
        )
          throw new Error('PUBLICATION_REVISION_CONFLICT');
      }
    }
    await validatePreparedArtifacts(draft, manifest);
    const approval = await approveManifest(manifest);
    const journal = await commitAndPushPublicationCandidate({
      repositoryRoot: join(workspaces, publicationId),
      storageRoot: options.storageRoot,
      manifestCanonical: draft.manifestCanonical,
      approval,
      markdownRelativePath: draft.markdownRelativePath,
    });
    const proven = getProvenPublicationState(journal);
    if (proven.status !== 'pushed' || proven.gitCommitSha === null)
      throw new Error('CANDIDATE_PUSH_UNPROVEN');
    const raw = await options.remote.request(
      '/publisher',
      { action: 'publish', publicationId, candidateSha: proven.gitCommitSha },
      publisherAttemptSchema,
    );
    if (raw.candidateSha !== proven.gitCommitSha) throw new Error('PUBLICATION_RESPONSE_MISMATCH');
    return toAttempt(raw, manifest);
  };
  const execute = async (publicationId: string): Promise<PublicationAttemptDto> => {
    const actor = requireActor(true);
    const active = locks.get(publicationId);
    if (active !== undefined) {
      if (active.userId !== actor.userId) return Promise.reject(new Error('NOT_ALLOWED'));
      return active.promise;
    }
    const promise = executeOnce(publicationId).finally(() => {
      locks.delete(publicationId);
    });
    locks.set(publicationId, { userId: actor.userId, promise });
    return promise;
  };
  const storedVersion = async (
    lawId: string,
    versionId: string,
  ): Promise<StoredPublicationVersion | null> => {
    let cursor: string | null = null;
    let item: z.infer<typeof PublicationHistoryResponseSchema>['items'][number] | undefined;
    const visited = new Set<string>();
    do {
      const page: z.infer<typeof PublicationHistoryResponseSchema> = await options.remote.request(
        '/publication/history',
        { lawId, cursor, limit: 100 },
        PublicationHistoryResponseSchema,
      );
      item = page.items.find((v) => v.versionId === versionId);
      if (item !== undefined) break;
      cursor = page.nextCursor;
      if (cursor !== null) {
        if (visited.has(cursor)) throw new Error('INVALID_PUBLICATION_HISTORY');
        visited.add(cursor);
      }
    } while (cursor !== null);
    if (item === undefined) return null;
    const root = await repository();
    await fetchCanonical(root);
    const entries = await manifests(root, item.gitCommitSha, lawId);
    const manifest = entries.find((v) => v.target.publicationNumber === item.publicationNumber);
    if (manifest === undefined) throw new Error('PUBLICATION_HISTORY_UNAVAILABLE');
    return { ...item, ast: await readAst(root, item.gitCommitSha, manifest) };
  };
  const historyService = createPublicationHistoryService({
    versions: {
      listByLawId: async (lawId) => {
        const page = await options.remote.request(
          '/publication/history',
          { lawId, cursor: null, limit: 100 },
          PublicationHistoryResponseSchema,
        );
        return Promise.all(
          page.items.map(async (v) => {
            const found = await storedVersion(lawId, v.versionId);
            if (found === null) throw new Error('PUBLICATION_HISTORY_UNAVAILABLE');
            return found;
          }),
        );
      },
      getById: storedVersion,
      getCurrent: async (lawId) => {
        const page = await options.remote.request(
          '/publication/history',
          { lawId, cursor: null, limit: 100 },
          PublicationHistoryResponseSchema,
        );
        const current = page.items.find((v) => v.isCurrent);
        return current === undefined ? null : storedVersion(lawId, current.versionId);
      },
    },
    now,
  });
  return {
    prepareSnapshot,
    async findPreparedUpdate(updateId, candidateArtifactId, revisionHash, baseVersionId) {
      z.uuid().parse(updateId);
      requireActor(true);
      const entries = await readdir(drafts).catch((error: unknown) => {
        if ((error as { code?: string }).code === 'ENOENT') return [];
        throw error;
      });
      if (entries.length > 10000) throw new Error('PUBLICATION_DRAFT_LIMIT');
      for (const entry of entries.sort()) {
        if (!/^[0-9a-f-]{36}\.json$/u.test(entry)) continue;
        const id = entry.slice(0, -5);
        const raw = draftSchema.parse(JSON.parse(await readSafe(join(drafts, entry))) as unknown);
        if (
          raw.userId !== requireActor(true).userId ||
          raw.updateId !== updateId ||
          raw.candidateArtifactId !== candidateArtifactId ||
          raw.revisionHash !== revisionHash
        )
          continue;
        const { draft, manifest } = await loadDraft(id);
        if (manifest.expectedBase.publishedVersionId === baseVersionId) {
          await validatePreparedArtifacts(draft, manifest);
          return draft.confirmation;
        }
      }
      return null;
    },
    async recordPreparedApproval(publicationId) {
      const { draft, manifest } = await loadDraft(publicationId);
      requireActor(true);
      await validatePreparedArtifacts(draft, manifest);
      await approveManifest(manifest);
    },
    async getPreparedConfirmation(publicationId) {
      return (await loadDraft(publicationId)).draft.confirmation;
    },
    async getPreparedProof(publicationId) {
      const { draft, manifest } = await loadDraft(publicationId);
      return {
        manifestCanonical: draft.manifestCanonical,
        identifiedAstCanonical: await readSafe(
          join(
            workspaces,
            publicationId,
            publicationIdentifiedAstRelativePath(
              manifest.law.directoryName,
              manifest.target.publicationNumber,
              manifest.target.version,
            ),
          ),
        ),
      };
    },
    async canAccessPublication(publicationId) {
      try {
        await loadDraft(publicationId);
        return true;
      } catch {
        return false;
      }
    },
    async prepare(input, revision: PublicationProjectRevision) {
      const snapshot = await options.projects.getPublicationSnapshot(input.projectId);
      if (snapshot.revisionHash !== revision.revisionHash)
        throw new Error('PUBLICATION_REVISION_CONFLICT');
      return prepareSnapshot(input.projectId, snapshot, input.sourceSummary);
    },
    execute,
    retry: execute,
    async getAttempt(publicationId) {
      const { manifest } = await loadDraft(publicationId);
      const journal = await journalStore.load(publicationId);
      const proven = journal === null ? null : getProvenPublicationState(journal);
      if (proven?.status !== 'pushed')
        return PublicationAttemptDtoSchema.parse({
          publicationId,
          lawId: manifest.law.lawId,
          version: manifest.target.version,
          publicationNumber: manifest.target.publicationNumber,
          publicationKind: manifest.target.kind,
          publicationAttemptStatus: proven?.status ?? 'prepared',
          resumeFromStatus: null,
          candidateSha: proven?.gitCommitSha ?? null,
          manifestDigest: calculatePublicationManifestDigest(manifest),
          publishedVersionId: null,
          updatedAt: journal?.events.at(-1)?.occurredAt ?? manifest.preparedAt,
          retryable: true,
          message: 'Artefatos locais preservados; publicação ainda não confirmada.',
        });
      return toAttempt(
        await options.remote.request(
          '/publisher',
          { action: 'getAttempt', publicationId },
          publisherAttemptSchema,
        ),
        manifest,
      );
    },
    async listHistory(input) {
      requireActor();
      const context = await contextFor(await projectAst(input.projectId));
      return options.remote.request(
        '/publication/history',
        { lawId: context.lawId, cursor: input.cursor, limit: input.limit },
        PublicationHistoryResponseSchema,
      );
    },
    async getDiff(input) {
      requireActor();
      const context = await contextFor(await projectAst(input.projectId));
      const diff = await historyService.diff(context.lawId, input.fromVersionId, input.toVersionId);
      return PublicationDiffDtoSchema.parse({ ...diff, changes: changeSummary(diff.changes) });
    },
    async prepareRollback(input) {
      requireActor(true);
      const context = await contextFor(await projectAst(input.projectId));
      const rollback = await historyService.prepareRollback({
        lawId: context.lawId,
        restoreVersionId: input.restoreVersionId,
        justification: input.justification,
      });
      const restored = await storedVersion(context.lawId, input.restoreVersionId);
      if (restored === null) throw new Error('PUBLICATION_HISTORY_UNAVAILABLE');
      const root = await repository();
      const entry = (await manifests(root, restored.gitCommitSha, context.lawId)).find(
        (v) => v.target.publicationNumber === restored.publicationNumber,
      );
      if (entry === undefined) throw new Error('PUBLICATION_HISTORY_UNAVAILABLE');
      const snapshots = await Promise.all(
        entry.sourceSnapshots.map(async (snapshot) => ({
          ...snapshot,
          bytes: await readGitBlob(
            root,
            restored.gitCommitSha,
            publicationSourceSnapshotRelativePath(
              entry.law.directoryName,
              snapshot.sourceArtifactSha256,
            ),
          ),
        })),
      );
      return prepareSnapshot(
        input.projectId,
        { ast: rollback.ast, revisionHash: calculateRevisionHash(rollback.ast, sha256), snapshots },
        `Rollback: ${rollback.justification}`.slice(0, 500),
        undefined,
        {
          restoredVersionId: rollback.restoredVersionId,
          restoredVersion: rollback.restoredVersion,
          justification: rollback.justification,
          projectRevisionHash: calculateRevisionHash(await projectAst(input.projectId), sha256),
        },
      );
    },
  };
};
