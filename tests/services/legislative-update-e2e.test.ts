import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  calculateNormativeHash,
  deriveStructuredChanges,
  formatar,
  generateUpdateMarkdown,
  identifiedMinima,
  origemMinima,
  type IdentifiedChildNode,
  type IdentifiedNormaAST,
  type SourceSnapshot,
} from '@lex-editor/legal-domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  InMemoryLegislativeUpdateQueue,
  createLegislativeUpdateReviewService,
  createLegislativeUpdateWorker,
  type LegislativeSourceCollector,
  type LegislativeUpdateJob,
  type LegislativeUpdateRecord,
} from '../../services/update-worker/src/index.js';
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
import { commitAndPushPublicationCandidate } from '../../src/main/publication/candidate-git.js';
import { getProvenPublicationState } from '../../src/main/publication/journal.js';
import {
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  publicationSourceSnapshotRelativePath,
  serializeCanonicalJson,
  serializePublicationManifest,
} from '../../src/shared/publication/manifest.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const NOW = new Date('2026-08-11T15:00:00.000Z');
const LAW_ID = '10000000-0000-4000-8000-000000000001';
const BASE_VERSION_ID = '10000000-0000-4000-8000-000000000002';
const PUBLISHED_VERSION_ID = '10000000-0000-4000-8000-000000000003';
const ACTOR_ID = '10000000-0000-4000-8000-000000000004';
const UPDATE_ID = '10000000-0000-4000-8000-000000000005';
const REJECTED_UPDATE_ID = '10000000-0000-4000-8000-000000000006';
const CANDIDATE_ARTIFACT_ID = '10000000-0000-4000-8000-000000000007';
const REJECTED_ARTIFACT_ID = '10000000-0000-4000-8000-000000000008';
const PUBLICATION_ID = '20000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '20000000-0000-4000-8000-000000000002';
const APPROVAL_ID = '20000000-0000-4000-8000-000000000003';
const TOKEN = 'editor-access-token-for-legislative-e2e';
const DIRECTORY_NAME = 'lei-de-atualizacao';
const SIGLA = 'lat';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true })));
});

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await execFileAsync('git', [...args], { cwd, encoding: 'utf8' });
  return result.stdout.trim();
};

const updateSourceReferences = (node: Record<string, unknown>, artifactSha256: string): void => {
  const sourceRef = node['sourceRef'];
  if (typeof sourceRef !== 'object' || sourceRef === null || Array.isArray(sourceRef)) {
    throw new Error('Fixture sem referência de fonte.');
  }
  node['sourceRef'] = { ...sourceRef, sourceArtifactSha256: artifactSha256 };
  const children = node['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      updateSourceReferences(child as Record<string, unknown>, artifactSha256);
    }
  }
};

const changedAst = (
  base: IdentifiedNormaAST,
  caput: string,
  artifactSha256: string,
): IdentifiedNormaAST => {
  const ast = clone(base);
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
  article.caput = caput;
  article.deviceStatus = 'amended';
  ast.publicationStatus = 'approved';
  updateSourceReferences(ast as unknown as Record<string, unknown>, artifactSha256);
  return ast;
};

const snapshot = (content: string): SourceSnapshot => {
  const digest = sha256(content);
  return {
    conteudo: content,
    sha256: digest,
    referencia: { ...origemMinima, sourceArtifactSha256: digest, fragmentSha256: digest },
  };
};

const collectBlockIds = (ast: IdentifiedNormaAST): readonly string[] => {
  const ids: string[] = [];
  const visit = (node: IdentifiedChildNode): void => {
    if (node.blockId !== undefined) ids.push(node.blockId);
    for (const child of node.children) visit(child);
  };
  for (const child of ast.children) visit(child);
  return ids.sort();
};

const createCollector = (
  candidateAst: IdentifiedNormaAST,
  sourceSnapshot: SourceSnapshot,
  candidateArtifactId: string,
): LegislativeSourceCollector => ({
  collect: () =>
    Promise.resolve({
      snapshots: [sourceSnapshot],
      candidateAst,
      candidateArtifactId,
    }),
});

const updateJob = (options: {
  publishedAst: IdentifiedNormaAST;
  baseVersionId: string;
  now: Date;
}): LegislativeUpdateJob => ({
  lawId: LAW_ID,
  lawSigla: SIGLA,
  lawTitle: 'Lei de atualização legislativa',
  sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lat.htm',
  baseVersionId: options.baseVersionId,
  baseNormativeSha256: calculateNormativeHash(options.publishedAst, sha256),
  publishedAst: options.publishedAst,
  schedule: {
    lawId: LAW_ID,
    intervalMs: 86_400_000,
    nextCheckAt: options.now.toISOString(),
    consecutiveFailures: 0,
    nextRetryAt: null,
    suspendedUntil: null,
  },
});

const createAttemptInfrastructure = () => {
  let record: PublisherAttemptRecord | null = null;
  let publicVersionId: string = BASE_VERSION_ID;
  const attempts: PublisherAttemptRepository = {
    findByPublicationId(publicationId, actorUserId) {
      return Promise.resolve(
        record?.publicationId === publicationId && actorUserId === ACTOR_ID ? record : null,
      );
    },
    findPublished(publicationId, candidateSha, actorUserId) {
      return Promise.resolve(
        record?.publicationAttemptStatus === 'published' &&
          record.publicationId === publicationId &&
          record.candidateSha === candidateSha &&
          actorUserId === ACTOR_ID
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
      return Promise.resolve(record);
    },
    markSyncing() {
      if (record === null) throw new Error('Tentativa ausente.');
      record = { ...record, publicationAttemptStatus: 'syncing', resumeFromStatus: null };
      return Promise.resolve(record);
    },
    markFailed(_publicationId, _candidateSha, resumeFromStatus) {
      if (record === null) throw new Error('Tentativa ausente.');
      record = { ...record, publicationAttemptStatus: 'failed', resumeFromStatus };
      return Promise.resolve(record);
    },
  };
  const transaction: PublisherTransactionGateway = {
    publishValidated() {
      if (record === null) throw new Error('Tentativa ausente.');
      publicVersionId = PUBLISHED_VERSION_ID;
      record = {
        ...record,
        publicationAttemptStatus: 'published',
        resumeFromStatus: null,
        publishedVersionId: publicVersionId,
      };
      return Promise.resolve(record);
    },
  };
  return { attempts, transaction, publicVersionId: () => publicVersionId };
};

describe('E2E da atualização legislativa com publicação segura', () => {
  it('detecta, aprova pelo fluxo integral da Feature 007 e rejeita sem alterar a versão pública', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lex-legislative-update-e2e-'));
    roots.push(root);
    const work = join(root, 'work');
    const remote = join(root, 'remote.git');
    const mirror = join(root, 'publisher.git');
    const journalRoot = join(root, 'journal');
    await mkdir(work);
    await git(root, ['init', '--bare', remote]);
    await git(work, ['init', '--initial-branch=main']);
    await git(work, ['config', 'user.name', 'Lex Update E2E']);
    await git(work, ['config', 'user.email', 'updates@example.invalid']);
    await git(work, ['remote', 'add', 'origin', remote]);

    const baseSnapshot = snapshot('<html>versão pública original</html>\n');
    const baseAst = clone(identifiedMinima);
    baseAst.sigla = SIGLA;
    baseAst.titulo = 'Lei de atualização legislativa';
    baseAst.publicationStatus = 'approved';
    const baseArticle = baseAst.children[0];
    if (baseArticle === undefined) throw new Error('Fixture sem dispositivo.');
    baseArticle.blockId = `${SIGLA}-art-1`;
    updateSourceReferences(baseAst as unknown as Record<string, unknown>, baseSnapshot.sha256);
    const baseFormatted = formatar(baseAst);
    if (!baseFormatted.ok) throw new Error('Fixture base inválida.');
    const initialChangelog = {
      publicationDate: '2026-08-10',
      version: '1.0.0',
      publicationNumber: 1,
      kind: 'initial' as const,
      sourceSummary: 'Publicação inicial conferida.',
      changes: deriveStructuredChanges(null, baseAst),
    };
    const lawRoot = join(work, 'leis', DIRECTORY_NAME);
    await mkdir(join(lawRoot, '.vinculex', 'releases'), { recursive: true });
    await mkdir(join(lawRoot, '.vinculex', 'sources'), { recursive: true });
    await writeFile(join(lawRoot, `${SIGLA}.md`), baseFormatted.valor, 'utf8');
    await writeFile(join(lawRoot, 'UPDATE.md'), generateUpdateMarkdown([initialChangelog]));
    await writeFile(
      join(work, publicationIdentifiedAstRelativePath(DIRECTORY_NAME, 1, '1.0.0')),
      serializeCanonicalJson(baseAst),
    );
    await writeFile(
      join(work, publicationSourceSnapshotRelativePath(DIRECTORY_NAME, baseSnapshot.sha256)),
      baseSnapshot.conteudo,
    );
    await git(work, ['add', '--', 'leis']);
    await git(work, ['commit', '--message', 'published base']);
    const baseSha = await git(work, ['rev-parse', 'HEAD']);
    await git(work, ['push', 'origin', 'main:refs/heads/main']);

    const candidateSnapshot = snapshot('<html>redação oficial atualizada</html>\n');
    const candidateAst = changedAst(
      baseAst,
      'Redação atualizada pela norma alteradora.',
      candidateSnapshot.sha256,
    );
    candidateAst.versaoVinculex = '1.1.0';
    const queueIds = [UPDATE_ID, REJECTED_UPDATE_ID];
    const queue = new InMemoryLegislativeUpdateQueue(
      () => queueIds.shift() ?? REJECTED_UPDATE_ID,
      () => NOW,
    );
    const worker = createLegislativeUpdateWorker({
      collector: createCollector(candidateAst, candidateSnapshot, CANDIDATE_ARTIFACT_ID),
      queue,
      sha256,
      now: () => NOW,
      random: () => 0.5,
    });
    const detection = await worker.run(
      updateJob({ publishedAst: baseAst, baseVersionId: BASE_VERSION_ID, now: NOW }),
    );
    if (detection.kind !== 'proposal_created') throw new Error('Proposta não detectada.');

    const approvals = createInMemoryPublicationApprovalRepository();
    const authority = createPublicationApprovalAuthority({
      identities: {
        findByUserId: (userId) =>
          Promise.resolve(
            userId === ACTOR_ID
              ? { userId, accountStatus: 'active' as const, roles: ['editor_juridico'] }
              : null,
          ),
      },
      approvals,
      generateUuid: () => APPROVAL_ID,
      now: () => new Date('2026-08-11T16:00:00.000Z'),
    });
    let preparedCount = 0;
    const review = createLegislativeUpdateReviewService({
      queue,
      publication: {
        async prepareLegislativeUpdate(record: LegislativeUpdateRecord, actorUserId: string) {
          expect(record.id).toBe(UPDATE_ID);
          expect(record.candidateArtifactId).toBe(CANDIDATE_ARTIFACT_ID);
          expect(actorUserId).toBe(ACTOR_ID);
          preparedCount += 1;
          const formatted = formatar(candidateAst);
          if (!formatted.ok) throw new Error('Candidata inválida.');
          const updateChangelog = {
            publicationDate: '2026-08-11',
            version: '1.1.0',
            publicationNumber: 2,
            kind: 'legislative_update' as const,
            sourceSummary: 'Alteração detectada e conferida na fonte oficial.',
            changingLaw: 'Lei sintética nº 2/2026',
            changes: deriveStructuredChanges(baseAst, candidateAst),
          };
          const updateMarkdown = generateUpdateMarkdown([initialChangelog, updateChangelog]);
          const astCanonical = serializeCanonicalJson(candidateAst);
          const manifest = {
            schemaVersion: 1 as const,
            publicationId: PUBLICATION_ID,
            idempotencyKey: IDEMPOTENCY_KEY,
            law: { lawId: LAW_ID, directoryName: DIRECTORY_NAME },
            target: {
              version: '1.1.0',
              publicationNumber: 2,
              kind: 'legislative_update' as const,
              impact: 'normative_projection' as const,
              restoredVersionId: null,
            },
            expectedBase: { gitCommitSha: baseSha, publishedVersionId: BASE_VERSION_ID },
            artifacts: {
              markdownSha256: sha256(formatted.valor),
              updateMarkdownSha256: sha256(updateMarkdown),
              identifiedAstSha256: sha256(astCanonical),
            },
            sourceSnapshots: [
              {
                sourceType: 'planalto_html' as const,
                sourceRole: 'primary_current' as const,
                sourceVariant: 'compiled' as const,
                sourceArtifactSha256: candidateSnapshot.sha256,
                capturedAt: NOW.toISOString(),
              },
            ],
            approvedBy: { userId: actorUserId, role: 'editor_juridico' as const },
            changelog: updateChangelog,
            preparedAt: '2026-08-11T16:00:00.000Z',
          };
          const manifestCanonical = serializePublicationManifest(manifest);
          await writeFile(join(lawRoot, `${SIGLA}.md`), formatted.valor, 'utf8');
          await writeFile(join(lawRoot, 'UPDATE.md'), updateMarkdown, 'utf8');
          await writeFile(
            join(work, publicationManifestRelativePath(DIRECTORY_NAME, 2, '1.1.0')),
            manifestCanonical,
          );
          await writeFile(
            join(work, publicationIdentifiedAstRelativePath(DIRECTORY_NAME, 2, '1.1.0')),
            astCanonical,
          );
          await writeFile(
            join(
              work,
              publicationSourceSnapshotRelativePath(DIRECTORY_NAME, candidateSnapshot.sha256),
            ),
            candidateSnapshot.conteudo,
          );
          const approval = await authority.approve(actorUserId, {
            publicationId: PUBLICATION_ID,
            manifestDigest: sha256(manifestCanonical),
          });
          const journal = await commitAndPushPublicationCandidate({
            repositoryRoot: work,
            storageRoot: journalRoot,
            manifestCanonical,
            approval,
            markdownRelativePath: `leis/${DIRECTORY_NAME}/${SIGLA}.md`,
          });
          const proven = getProvenPublicationState(journal);
          if (proven.status !== 'pushed' || proven.gitCommitSha === null) {
            throw new Error('O candidato não foi comprovadamente enviado.');
          }
          return { publicationId: PUBLICATION_ID };
        },
      },
    });

    const approved = await review.approve(detection.updateId, ACTOR_ID);
    expect(approved).toMatchObject({
      updateReviewStatus: 'approved',
      approvedBy: ACTOR_ID,
      publicationId: PUBLICATION_ID,
    });
    expect(preparedCount).toBe(1);
    const candidateSha = await git(work, ['rev-parse', `refs/heads/releases/${PUBLICATION_ID}`]);

    await git(root, ['clone', '--mirror', remote, mirror]);
    const gitRepository = await createPublisherGitRepository({ repositoryRoot: mirror });
    const baselines: PublicationBaselineRepository = {
      getByLawId: (lawId) =>
        Promise.resolve({
          lawId,
          publishedVersionId: BASE_VERSION_ID,
          gitCommitSha: baseSha,
          version: '1.0.0',
          publicationNumber: 1,
          ast: baseAst,
          historicalBlockIds: collectBlockIds(baseAst),
          redirects: [],
        }),
      versionBelongsToLaw: () => Promise.resolve(false),
    };
    const infrastructure = createAttemptInfrastructure();
    const publisher = createPublisherService({
      authenticator: {
        authenticate: (token) => Promise.resolve(token === TOKEN ? { userId: ACTOR_ID } : null),
      },
      approvals: authority,
      git: gitRepository,
      baselines,
      attempts: infrastructure.attempts,
      transaction: infrastructure.transaction,
    });
    expect(infrastructure.publicVersionId()).toBe(BASE_VERSION_ID);
    const published = await publisher.publish(TOKEN, {
      publicationId: PUBLICATION_ID,
      candidateSha,
    });
    expect(published).toMatchObject({
      publicationAttemptStatus: 'published',
      publishedVersionId: PUBLISHED_VERSION_ID,
    });
    expect(infrastructure.publicVersionId()).toBe(PUBLISHED_VERSION_ID);
    expect(await git(remote, ['rev-parse', 'refs/heads/main'])).toBe(candidateSha);

    const rejectedAt = new Date('2026-08-12T15:00:00.000Z');
    const rejectedSnapshot = snapshot('<html>nova candidata a rejeitar</html>\n');
    const rejectedAst = changedAst(
      candidateAst,
      'Redação candidata que não deve ser publicada.',
      rejectedSnapshot.sha256,
    );
    const rejectedWorker = createLegislativeUpdateWorker({
      collector: createCollector(rejectedAst, rejectedSnapshot, REJECTED_ARTIFACT_ID),
      queue,
      sha256,
      now: () => rejectedAt,
      random: () => 0.5,
    });
    const rejectedDetection = await rejectedWorker.run(
      updateJob({
        publishedAst: candidateAst,
        baseVersionId: PUBLISHED_VERSION_ID,
        now: rejectedAt,
      }),
    );
    if (rejectedDetection.kind !== 'proposal_created') {
      throw new Error('Segunda proposta não detectada.');
    }
    const rejectionReason = 'A candidata diverge da redação confirmada na fonte compilada.';
    const rejected = await review.reject(rejectedDetection.updateId, ACTOR_ID, rejectionReason);
    expect(rejected).toMatchObject({
      updateReviewStatus: 'rejected',
      rejectedBy: ACTOR_ID,
      rejectionReason,
    });
    expect(preparedCount).toBe(1);
    expect(infrastructure.publicVersionId()).toBe(PUBLISHED_VERSION_ID);
    expect(await git(remote, ['rev-parse', 'refs/heads/main'])).toBe(candidateSha);
  }, 30_000);
});
