import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  deriveStructuredChanges,
  formatar,
  generateUpdateMarkdown,
  identifiedMinima,
  type IdentifiedNormaAST,
} from '@lex-editor/legal-domain';

import { createPublicationApprovalAuthority } from '../../../services/publisher/src/approval.js';
import { createPublisherDatabase } from '../../../services/publisher/src/database.js';
import { createPublisherGitRepository } from '../../../services/publisher/src/git-repository.js';
import { createPublisherService } from '../../../services/publisher/src/service.js';
import { commitAndPushPublicationCandidate } from '../../../src/main/publication/candidate-git.js';
import { getProvenPublicationState } from '../../../src/main/publication/journal.js';
import {
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  publicationSourceSnapshotRelativePath,
  serializeCanonicalJson,
  serializePublicationManifest,
} from '../../../src/shared/publication/manifest.js';
import {
  createDisposableAuditSql,
  runDisposableSql,
  PUBLICATION_AUDIT_ADMIN_ID,
} from './publication-audit-database.js';

const command = promisify(execFile);
const editorId = '44444444-4444-4444-8444-444444444444';
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export const createPublicationAuditFixture = async (
  options: { initialAst?: IdentifiedNormaAST } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'lex-publication-audit-'));
  const containerName = `lex-publication-audit-${randomUUID().slice(0, 8)}`;
  const close = async () => {
    await command('docker', ['stop', '--timeout', '1', containerName]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  };
  try {
    await command('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--env',
      'POSTGRES_PASSWORD=disposable-test',
      '--env',
      'POSTGRES_DB=lex_audit_test',
      'postgres:16-alpine',
    ]);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await runDisposableSql(containerName, 'select 1;');
        break;
      } catch {
        if (attempt >= 40) throw new Error('Disposable database did not start.');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await runDisposableSql(
      containerName,
      'create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key);',
    );
    const migrations = (await readdir('supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const migration of migrations)
      await runDisposableSql(
        containerName,
        await readFile(join('supabase/migrations', migration), 'utf8'),
      );
    const lawId = randomUUID();
    await runDisposableSql(
      containerName,
      `insert into auth.users(id) values ('${editorId}'), ('${PUBLICATION_AUDIT_ADMIN_ID}');
      insert into public.usuarios_perfil(user_id,nome_exibicao,papel,account_status) values ('${editorId}','Editor E2E','curador','active'),('${PUBLICATION_AUDIT_ADMIN_ID}','Administrador E2E','administrador','active');
      insert into public.leis(id,sigla,titulo,tipo,numero,ano,ramo,fonte_url,data_publicacao) values ('${lawId}','LDEM','Lei de demonstração','lei ordinária','1',2026,'teste','https://www.planalto.gov.br/','2026-08-10');
      create role publication_audit_ui_reader login; grant lex_audit_reader to publication_audit_ui_reader;\n      create role publication_publisher_fixture login; grant lex_publisher to publication_publisher_fixture;`,
    );
    const work = join(root, 'work');
    const remote = join(root, 'remote.git');
    const mirror = join(root, 'publisher.git');
    await mkdir(work);
    const gitCommand = async (cwd: string, args: readonly string[]) =>
      (await command('git', [...args], { cwd, encoding: 'utf8' })).stdout.trim();
    await gitCommand(root, ['init', '--bare', remote]);
    await gitCommand(work, ['init', '--initial-branch=main']);
    await gitCommand(work, ['config', 'user.name', 'Publication Audit E2E']);
    await gitCommand(work, ['config', 'user.email', 'audit@example.invalid']);
    await writeFile(join(work, 'README.md'), 'Disposable canonical repository.\n');
    await gitCommand(work, ['add', '--', 'README.md']);
    await gitCommand(work, ['commit', '--message', 'canonical base']);
    await gitCommand(work, ['remote', 'add', 'origin', remote]);
    await gitCommand(work, ['push', 'origin', 'main:refs/heads/main']);
    const baseSha = await gitCommand(work, ['rev-parse', 'HEAD']);
    const snapshot = '<html>Fonte oficial sintética para publicação auditável.</html>\n';
    const snapshotSha = sha256(snapshot);
    const ast = structuredClone(options.initialAst ?? identifiedMinima);
    ast.publicationStatus = 'approved';
    const refs = (node: Record<string, unknown>): void => {
      node['sourceRef'] = {
        ...(node['sourceRef'] as Record<string, unknown>),
        sourceArtifactSha256: snapshotSha,
      };
      if (Array.isArray(node['children']))
        for (const child of node['children']) refs(child as Record<string, unknown>);
    };
    refs(ast as unknown as Record<string, unknown>);
    const formatted = formatar(ast);
    if (!formatted.ok) throw new Error('Invalid publication fixture.');
    const astCanonical = serializeCanonicalJson(ast);
    const publicationId = randomUUID();
    const directoryName = 'lei-de-demonstracao';
    const instant = new Date().toISOString();
    const changelog = {
      publicationDate: instant.slice(0, 10),
      version: '1.0.0',
      publicationNumber: 1,
      kind: 'initial' as const,
      sourceSummary: 'Fonte verificada para a publicação E2E.',
      changes: deriveStructuredChanges(null, ast),
    };
    const update = generateUpdateMarkdown([changelog]);
    const manifest = {
      schemaVersion: 1 as const,
      publicationId,
      idempotencyKey: randomUUID(),
      law: { lawId, directoryName },
      target: {
        version: '1.0.0',
        publicationNumber: 1,
        kind: 'initial' as const,
        impact: 'normative_projection' as const,
        restoredVersionId: null,
      },
      expectedBase: { gitCommitSha: baseSha, publishedVersionId: null },
      artifacts: {
        markdownSha256: sha256(formatted.valor),
        updateMarkdownSha256: sha256(update),
        identifiedAstSha256: sha256(astCanonical),
      },
      sourceSnapshots: [
        {
          sourceType: 'planalto_html' as const,
          sourceRole: 'primary_current' as const,
          sourceVariant: 'compiled' as const,
          sourceArtifactSha256: snapshotSha,
          capturedAt: instant,
        },
      ],
      approvedBy: { userId: editorId, role: 'editor_juridico' as const },
      changelog,
      preparedAt: instant,
    };
    const canonical = serializePublicationManifest(manifest);
    const lawRoot = join(work, 'leis', directoryName);
    await mkdir(join(lawRoot, '.vinculex/releases'), { recursive: true });
    await mkdir(join(lawRoot, '.vinculex/sources'), { recursive: true });
    const markdownRelativePath = `leis/${directoryName}/${ast.sigla}.md`;
    await Promise.all([
      writeFile(join(work, markdownRelativePath), formatted.valor),
      writeFile(join(lawRoot, 'UPDATE.md'), update),
      writeFile(join(work, publicationManifestRelativePath(directoryName, 1, '1.0.0')), canonical),
      writeFile(
        join(work, publicationIdentifiedAstRelativePath(directoryName, 1, '1.0.0')),
        astCanonical,
      ),
      writeFile(
        join(work, publicationSourceSnapshotRelativePath(directoryName, snapshotSha)),
        snapshot,
      ),
    ]);
    await command('git', ['clone', '--bare', remote, mirror]);
    const repository = await createPublisherGitRepository({ repositoryRoot: mirror });
    const database = createPublisherDatabase({
      sql: createDisposableAuditSql(containerName, 'publication_publisher_fixture'),
      git: repository,
    });
    const approvals = createPublicationApprovalAuthority({
      identities: database.identities,
      approvals: database.approvals,
    });
    const publisher = createPublisherService({
      authenticator: {
        authenticate: (token) =>
          Promise.resolve(token === 'disposable-editor-session' ? { userId: editorId } : null),
      },
      approvals,
      git: repository,
      baselines: database.baselines,
      attempts: database.attempts,
      transaction: database.transaction,
    });
    const approval = await publisher.approve('disposable-editor-session', {
      publicationId,
      manifestDigest: sha256(canonical),
    });
    const journal = await commitAndPushPublicationCandidate({
      repositoryRoot: work,
      storageRoot: join(root, 'journal'),
      manifestCanonical: canonical,
      approval,
      markdownRelativePath,
    });
    const proven = getProvenPublicationState(journal);
    if (proven.gitCommitSha === null) throw new Error('Publication candidate was not committed.');
    const published = await publisher.publish('disposable-editor-session', {
      publicationId,
      candidateSha: proven.gitCommitSha,
    });
    if (published.publicationAttemptStatus !== 'published' || published.publishedVersionId === null)
      throw new Error('Actual publisher did not confirm publication.');
    const repeated = await publisher.publish('disposable-editor-session', {
      publicationId,
      candidateSha: proven.gitCommitSha,
    });
    if (repeated.publishedVersionId !== published.publishedVersionId)
      throw new Error('Publisher retry duplicated publication.');
    const rows = await createDisposableAuditSql(containerName).query<{ count: string }>(
      'select count(*)::text as count from private.publication_events where publication_id=$1::uuid and event_type=$2::text',
      [publicationId, 'published'],
    );
    if (rows[0]?.count !== '1') throw new Error('Publication audit terminal was duplicated.');
    return {
      root,
      containerName,
      publicationId,
      lawId,
      candidateSha: proven.gitCommitSha,
      publishedVersionId: published.publishedVersionId,
      work,
      gitCommand,
      publisher,
      database,
      repository,
      ast,
      manifest,
      update,
      markdownRelativePath,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};
