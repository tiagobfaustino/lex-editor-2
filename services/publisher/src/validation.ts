import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  deriveStructuredChanges,
  formatar,
  generateUpdateMarkdown,
  projetar,
  reconciliar,
  registrarPublicacao,
  REGISTRO_VAZIO,
  validarIdentifiedNormaAst,
  type BlockIdDepreciado,
  type IdentifiedNormaAST,
  type Projecao,
  type RegistroPublicado,
  type StructuredChanges,
} from '@lex-editor/legal-domain';
import { z } from 'zod';

import {
  parseCanonicalPublicationManifest,
  publicationGitShaSchema,
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  publicationSourceSnapshotRelativePath,
  publicationUuidSchema,
  serializeCanonicalJson,
  serializePublicationManifest,
  validatePublicationSequence,
  type PublicationManifest,
} from '../../../src/shared/publication/manifest.js';
import type { PublicationApprovalAuthority } from './approval.js';

const MAX_BLOB_BYTES = 64 * 1024 * 1024;
const MARKDOWN_PATH = /^leis\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const SECRET_PATTERNS = [
  /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/u,
  /\bsb_secret_[A-Za-z0-9_-]{16,}\b/u,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY\s*=/u,
] as const;

export const publishCandidateRequestSchema = z.strictObject({
  publicationId: publicationUuidSchema,
  candidateSha: publicationGitShaSchema,
});

export interface PublisherGitReader {
  fetchCandidate(publicationId: string): Promise<string>;
  getCanonicalSha(): Promise<string>;
  getParentSha(commitSha: string): Promise<string>;
  listChangedPaths(baseSha: string, commitSha: string): Promise<readonly string[]>;
  listTreeEntries(
    commitSha: string,
    paths: readonly string[],
  ): Promise<readonly Readonly<{ mode: string; path: string }>[]>;
  readBlob(commitSha: string, path: string): Promise<Uint8Array>;
}

export interface PublicationBaseline {
  readonly lawId: string;
  readonly publishedVersionId: string | null;
  readonly gitCommitSha: string | null;
  readonly version: string | null;
  readonly publicationNumber: number | null;
  readonly ast: IdentifiedNormaAST | null;
  readonly historicalBlockIds: readonly string[];
  readonly redirects: readonly BlockIdDepreciado[];
}

export interface PublicationBaselineRepository {
  getByLawId(lawId: string, lawDirectoryName: string): Promise<PublicationBaseline>;
  versionBelongsToLaw(lawId: string, versionId: string): Promise<boolean>;
}

export interface PublicationSyncPayload {
  readonly publication: Readonly<{
    id: string;
    lawId: string;
    idempotencyKey: string;
    version: string;
    publicationNumber: number;
    kind: PublicationManifest['target']['kind'];
    restoredVersionId: string | null;
    gitCommitSha: string;
    manifestDigest: string;
    approvedBy: string;
    expectedPublishedVersionId: string | null;
    expectedGitBaseSha: string;
  }>;
  readonly projection: Readonly<{
    lei: Projecao['lei'];
    version: Projecao['versao'];
    raiz: Projecao['raiz'];
    dispositivos: Projecao['dispositivos'];
  }>;
  readonly changelog: string;
  readonly changes: StructuredChanges;
  readonly sourceArtifacts: readonly Readonly<{
    sourceType: string;
    sourceRole: string;
    sourceVariant: string;
    sourceUrl: string | null;
    finalUrl: string | null;
    artifactSha256: string;
    artifactUri: string;
    capturedAt: string;
  }>[];
  readonly blockIds: readonly string[];
  readonly redirects: readonly Readonly<{
    from: string;
    to: string;
    reason: string;
  }>[];
  readonly devices: readonly Readonly<{
    id: string;
    parentId: string | null;
    row: Projecao['dispositivos'][number];
  }>[];
}

export interface ValidatedPublicationCandidate {
  readonly publicationId: string;
  readonly candidateSha: string;
  readonly manifestDigest: string;
  readonly manifest: Readonly<PublicationManifest>;
  readonly canonicalAlreadyPromoted: boolean;
  readonly payload: PublicationSyncPayload;
}

export class PublisherValidationError extends Error {
  constructor(
    readonly code:
      | 'candidate_ref_mismatch'
      | 'canonical_base_changed'
      | 'invalid_candidate'
      | 'manifest_mismatch'
      | 'artifact_hash_mismatch'
      | 'legal_validation_failed'
      | 'sequence_conflict'
      | 'secret_detected',
    message: string,
  ) {
    super(message);
  }
}

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

const decodeUtf8 = (bytes: Uint8Array, label: string): string => {
  if (bytes.byteLength > MAX_BLOB_BYTES) {
    throw new PublisherValidationError('invalid_candidate', `${label} excede o limite permitido.`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PublisherValidationError('invalid_candidate', `${label} não contém UTF-8 válido.`);
  }
};

const assertNoSecrets = (bytes: Uint8Array): void => {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new PublisherValidationError(
      'secret_detected',
      'O release candidate contém um padrão de credencial proibido.',
    );
  }
};

const sameJson = (left: unknown, right: unknown): boolean =>
  serializeCanonicalJson(left) === serializeCanonicalJson(right);

const prependChangelogEntry = (
  previousUpdate: string | null,
  entry: PublicationManifest['changelog'],
): string => {
  const current = generateUpdateMarkdown([entry]);
  if (previousUpdate === null) return current;
  const header = '# Atualizações\n\n';
  if (!previousUpdate.startsWith(header) || !previousUpdate.endsWith('\n')) {
    throw new PublisherValidationError(
      'legal_validation_failed',
      'O UPDATE.md da base não é um changelog canônico.',
    );
  }
  return `${current.trimEnd()}\n\n${previousUpdate.slice(header.length)}`;
};

const collectSourceReferences = (ast: IdentifiedNormaAST): readonly Record<string, unknown>[] => {
  const references: Record<string, unknown>[] = [];
  const visit = (node: Record<string, unknown>): void => {
    references.push(node['sourceRef'] as Record<string, unknown>);
    const supporting = node['supportingSourceRefs'];
    if (Array.isArray(supporting)) {
      references.push(...(supporting as Record<string, unknown>[]));
    }
    const children = node['children'];
    if (Array.isArray(children)) {
      for (const child of children) visit(child as Record<string, unknown>);
    }
  };
  visit(ast as unknown as Record<string, unknown>);
  return references;
};

const assertSourceSet = (ast: IdentifiedNormaAST, manifest: PublicationManifest): void => {
  const declared = new Map(
    manifest.sourceSnapshots.map((snapshot) => [snapshot.sourceArtifactSha256, snapshot]),
  );
  for (const reference of collectSourceReferences(ast)) {
    const digest = reference['sourceArtifactSha256'];
    const snapshot = typeof digest === 'string' ? declared.get(digest) : undefined;
    if (
      snapshot === undefined ||
      snapshot.sourceType !== reference['sourceType'] ||
      snapshot.sourceRole !== reference['sourceRole'] ||
      snapshot.sourceVariant !== reference['sourceVariant'] ||
      (snapshot.sourceUrl ?? undefined) !== (reference['sourceUrl'] ?? undefined)
    ) {
      throw new PublisherValidationError(
        'legal_validation_failed',
        'Uma referência da AST não corresponde ao conjunto de snapshots aprovado.',
      );
    }
  }
};

const uuidV5 = (namespaceUuid: string, name: string): string => {
  const namespace = Buffer.from(namespaceUuid.replaceAll('-', ''), 'hex');
  const digest = createHash('sha1').update(namespace).update(name, 'utf8').digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const buildRegistry = (baseline: PublicationBaseline, sigla: string): RegistroPublicado => {
  const base: RegistroPublicado = {
    namespace: [...baseline.historicalBlockIds],
    porPosicao: {},
    aliases: [...baseline.redirects],
  };
  return baseline.ast === null ? base : registrarPublicacao(baseline.ast, sigla, base);
};

const buildSyncPayload = (options: {
  manifest: PublicationManifest;
  candidateSha: string;
  manifestDigest: string;
  ast: IdentifiedNormaAST;
  changes: StructuredChanges;
}): PublicationSyncPayload => {
  const domainProjection = projetar(options.ast);
  const idByInternalId = new Map(
    domainProjection.dispositivos.map((row) => [
      row.id,
      uuidV5(options.manifest.law.lawId, `${options.manifest.publicationId}:${row.id}`),
    ]),
  );
  const devices = domainProjection.dispositivos.map((row) => ({
    id: idByInternalId.get(row.id) ?? '',
    parentId: row.parent_id === null ? null : (idByInternalId.get(row.parent_id) ?? ''),
    row,
  }));
  const blockIds = [
    ...new Set(
      domainProjection.dispositivos.flatMap((row) => (row.block_id === null ? [] : [row.block_id])),
    ),
  ].sort();
  return {
    publication: {
      id: options.manifest.publicationId,
      lawId: options.manifest.law.lawId,
      idempotencyKey: options.manifest.idempotencyKey,
      version: options.manifest.target.version,
      publicationNumber: options.manifest.target.publicationNumber,
      kind: options.manifest.target.kind,
      restoredVersionId: options.manifest.target.restoredVersionId,
      gitCommitSha: options.candidateSha,
      manifestDigest: options.manifestDigest,
      approvedBy: options.manifest.approvedBy.userId,
      expectedPublishedVersionId: options.manifest.expectedBase.publishedVersionId,
      expectedGitBaseSha: options.manifest.expectedBase.gitCommitSha,
    },
    projection: {
      lei: domainProjection.lei,
      version: domainProjection.versao,
      raiz: domainProjection.raiz,
      dispositivos: domainProjection.dispositivos,
    },
    changelog: generateUpdateMarkdown([options.manifest.changelog]),
    changes: options.changes,
    sourceArtifacts: options.manifest.sourceSnapshots.map((snapshot) => ({
      sourceType: snapshot.sourceType,
      sourceRole: snapshot.sourceRole,
      sourceVariant: snapshot.sourceVariant,
      sourceUrl: snapshot.sourceUrl ?? null,
      finalUrl: snapshot.finalUrl ?? null,
      artifactSha256: snapshot.sourceArtifactSha256,
      artifactUri: `git:${options.candidateSha}:${publicationSourceSnapshotRelativePath(
        options.manifest.law.directoryName,
        snapshot.sourceArtifactSha256,
      )}`,
      capturedAt: snapshot.capturedAt,
    })),
    blockIds,
    redirects: (options.ast.idsDepreciados ?? []).map((redirect) => ({
      from: redirect.antigo,
      to: redirect.novo,
      reason: 'Redirecionamento declarado na IdentifiedNormaAST aprovada.',
    })),
    devices,
  };
};

export const validatePublicationCandidate = async (options: {
  request: unknown;
  authenticatedUserId: string;
  git: PublisherGitReader;
  approvals: PublicationApprovalAuthority;
  baselines: PublicationBaselineRepository;
}): Promise<ValidatedPublicationCandidate> => {
  const request = publishCandidateRequestSchema.parse(options.request);
  const remoteCandidateSha = await options.git.fetchCandidate(request.publicationId);
  if (remoteCandidateSha !== request.candidateSha) {
    throw new PublisherValidationError(
      'candidate_ref_mismatch',
      'O SHA solicitado não é a ponta do branch candidato.',
    );
  }
  const parentSha = await options.git.getParentSha(request.candidateSha);
  const changedPaths = [
    ...(await options.git.listChangedPaths(parentSha, request.candidateSha)),
  ].sort();
  const manifestPaths = changedPaths.filter(
    (path) => /\.vinculex\/releases\/\d{6}-[^/]+\.json$/u.test(path) && !path.endsWith('.ast.json'),
  );
  if (manifestPaths.length !== 1) {
    throw new PublisherValidationError(
      'invalid_candidate',
      'O candidato deve conter um manifesto único.',
    );
  }
  const manifestPath = manifestPaths[0];
  if (manifestPath === undefined)
    throw new PublisherValidationError('invalid_candidate', 'Manifesto ausente.');
  const manifestBytes = await options.git.readBlob(request.candidateSha, manifestPath);
  assertNoSecrets(manifestBytes);
  const manifest = parseCanonicalPublicationManifest(manifestBytes);
  if (
    manifest.publicationId !== request.publicationId ||
    parentSha !== manifest.expectedBase.gitCommitSha
  ) {
    throw new PublisherValidationError(
      'manifest_mismatch',
      'O manifesto não corresponde ao candidato e à sua base.',
    );
  }
  const expectedManifestPath = publicationManifestRelativePath(
    manifest.law.directoryName,
    manifest.target.publicationNumber,
    manifest.target.version,
  );
  if (
    manifestPath !== expectedManifestPath ||
    serializePublicationManifest(manifest) !== decodeUtf8(manifestBytes, 'manifesto')
  ) {
    throw new PublisherValidationError(
      'manifest_mismatch',
      'O manifesto não ocupa seu path canônico exato.',
    );
  }
  const manifestDigest = sha256(manifestBytes);
  const approval = await options.approvals.assertApproved({
    publicationId: manifest.publicationId,
    manifestDigest,
    approvedByUserId: manifest.approvedBy.userId,
  });
  if (approval.userId !== options.authenticatedUserId) {
    throw new PublisherValidationError(
      'manifest_mismatch',
      'O solicitante não é o editor que aprovou o manifesto.',
    );
  }

  const baseline = await options.baselines.getByLawId(
    manifest.law.lawId,
    manifest.law.directoryName,
  );
  if (
    baseline.publishedVersionId !== manifest.expectedBase.publishedVersionId ||
    (baseline.gitCommitSha !== null && baseline.gitCommitSha !== manifest.expectedBase.gitCommitSha)
  ) {
    throw new PublisherValidationError(
      'sequence_conflict',
      'A versão pública mudou depois da aprovação.',
    );
  }
  const canonicalSha = await options.git.getCanonicalSha();
  if (
    canonicalSha !== manifest.expectedBase.gitCommitSha &&
    canonicalSha !== request.candidateSha
  ) {
    throw new PublisherValidationError(
      'canonical_base_changed',
      'O branch canônico mudou depois da aprovação.',
    );
  }
  validatePublicationSequence({
    previousVersion: baseline.version,
    previousPublicationNumber: baseline.publicationNumber,
    targetVersion: manifest.target.version,
    targetPublicationNumber: manifest.target.publicationNumber,
    impact: manifest.target.impact,
  });
  if (
    manifest.target.restoredVersionId !== null &&
    !(await options.baselines.versionBelongsToLaw(
      manifest.law.lawId,
      manifest.target.restoredVersionId,
    ))
  ) {
    throw new PublisherValidationError(
      'sequence_conflict',
      'A versão restaurada não pertence à lei publicada.',
    );
  }

  const lawRoot = `leis/${manifest.law.directoryName}`;
  const markdownPaths = changedPaths.filter((path) => MARKDOWN_PATH.test(path));
  if (markdownPaths.length !== 1 || !markdownPaths[0]?.startsWith(`${lawRoot}/`)) {
    throw new PublisherValidationError(
      'invalid_candidate',
      'O candidato deve alterar o Markdown de uma única lei.',
    );
  }
  const markdownPath = markdownPaths[0];
  const updatePath = `${lawRoot}/UPDATE.md`;
  const astPath = publicationIdentifiedAstRelativePath(
    manifest.law.directoryName,
    manifest.target.publicationNumber,
    manifest.target.version,
  );
  const snapshotPaths = manifest.sourceSnapshots.map((snapshot) =>
    publicationSourceSnapshotRelativePath(
      manifest.law.directoryName,
      snapshot.sourceArtifactSha256,
    ),
  );
  const fixedPaths = [markdownPath, updatePath, manifestPath, astPath].sort();
  const requiredPaths = [...fixedPaths, ...snapshotPaths].sort();
  if (
    fixedPaths.some((path) => !changedPaths.includes(path)) ||
    changedPaths.some((path) => !requiredPaths.includes(path))
  ) {
    throw new PublisherValidationError(
      'invalid_candidate',
      'O candidato contém paths ausentes ou inesperados.',
    );
  }
  const tree = await options.git.listTreeEntries(request.candidateSha, requiredPaths);
  if (tree.length !== requiredPaths.length || tree.some((entry) => entry.mode !== '100644')) {
    throw new PublisherValidationError(
      'invalid_candidate',
      'O candidato contém symlink ou arquivo executável.',
    );
  }

  const [markdownBytes, updateBytes, astBytes, ...snapshotBytes] = await Promise.all([
    options.git.readBlob(request.candidateSha, markdownPath),
    options.git.readBlob(request.candidateSha, updatePath),
    options.git.readBlob(request.candidateSha, astPath),
    ...snapshotPaths.map((path) => options.git.readBlob(request.candidateSha, path)),
  ]);
  for (const bytes of [markdownBytes, updateBytes, astBytes, ...snapshotBytes])
    assertNoSecrets(bytes);
  if (
    sha256(markdownBytes) !== manifest.artifacts.markdownSha256 ||
    sha256(updateBytes) !== manifest.artifacts.updateMarkdownSha256 ||
    sha256(astBytes) !== manifest.artifacts.identifiedAstSha256 ||
    snapshotBytes.some(
      (bytes, index) => sha256(bytes) !== manifest.sourceSnapshots[index]?.sourceArtifactSha256,
    )
  ) {
    throw new PublisherValidationError(
      'artifact_hash_mismatch',
      'Um artefato não corresponde ao hash aprovado.',
    );
  }

  const astText = decodeUtf8(astBytes, 'IdentifiedNormaAST');
  let rawAst: unknown;
  try {
    rawAst = JSON.parse(astText) as unknown;
  } catch {
    throw new PublisherValidationError(
      'legal_validation_failed',
      'A IdentifiedNormaAST contém JSON inválido.',
    );
  }
  const astValidation = validarIdentifiedNormaAst(rawAst);
  if (!astValidation.ok || serializeCanonicalJson(astValidation.valor) !== astText) {
    throw new PublisherValidationError(
      'legal_validation_failed',
      'A IdentifiedNormaAST não é canônica e válida.',
    );
  }
  const ast = astValidation.valor;
  if (ast.versaoVinculex !== manifest.target.version || ast.publicationStatus !== 'approved') {
    throw new PublisherValidationError(
      'legal_validation_failed',
      'A AST não representa a versão editorial aprovada.',
    );
  }
  assertSourceSet(ast, manifest);
  const formatted = formatar(ast);
  if (!formatted.ok || formatted.valor !== decodeUtf8(markdownBytes, 'Markdown')) {
    throw new PublisherValidationError(
      'legal_validation_failed',
      'O Markdown não deriva exatamente da AST aprovada.',
    );
  }

  const registry = baseline.ast === null ? REGISTRO_VAZIO : buildRegistry(baseline, ast.sigla);
  const reconciled = reconciliar(ast, registry, ast.sigla);
  if (!reconciled.ok || !sameJson(reconciled.valor.arvore, ast)) {
    throw new PublisherValidationError(
      'legal_validation_failed',
      'Os Block IDs não preservam o namespace publicado.',
    );
  }
  const changes = deriveStructuredChanges(baseline.ast, ast);
  if (!sameJson(changes, manifest.changelog.changes)) {
    throw new PublisherValidationError(
      'legal_validation_failed',
      'O diff estruturado não corresponde ao manifesto.',
    );
  }
  const previousUpdate =
    baseline.ast === null
      ? null
      : decodeUtf8(await options.git.readBlob(parentSha, updatePath), 'UPDATE.md base');
  if (
    decodeUtf8(updateBytes, 'UPDATE.md') !==
    prependChangelogEntry(previousUpdate, manifest.changelog)
  ) {
    throw new PublisherValidationError(
      'legal_validation_failed',
      'O UPDATE.md não é a continuação canônica da base.',
    );
  }

  return Object.freeze({
    publicationId: manifest.publicationId,
    candidateSha: request.candidateSha,
    manifestDigest,
    manifest,
    canonicalAlreadyPromoted: canonicalSha === request.candidateSha,
    payload: buildSyncPayload({
      manifest,
      candidateSha: request.candidateSha,
      manifestDigest,
      ast,
      changes,
    }),
  });
};
