import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  deriveStructuredChanges,
  formatar,
  generateUpdateMarkdown,
  identifiedMinima,
  type IdentifiedNormaAST,
} from '@lex-editor/legal-domain';

import { commitAndPushPublicationCandidate } from '../../src/main/publication/candidate-git.js';
import { getProvenPublicationState } from '../../src/main/publication/journal.js';
import {
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  serializeCanonicalJson,
  serializePublicationManifest,
  type PublicationManifest,
} from '../../src/shared/publication/manifest.js';
import { createDisposableAuditSql } from './support/publication-audit-database.js';
import { createPublicationAuditFixture } from './support/publication-audit-fixture.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const token = 'disposable-editor-session';

test('actual publisher restores historical IDs and rejects independently approved false rollbacks', async () => {
  test.setTimeout(60_000);
  const initial = structuredClone(identifiedMinima);
  const secondArticle = structuredClone(initial.children[0]);
  if (secondArticle?.tipo !== 'artigo') throw new Error('Expected an article fixture.');
  secondArticle.id = 'no-art-2';
  secondArticle.ordem = 1;
  secondArticle.numero = '2';
  secondArticle.blockId = 'ldem-art-2';
  secondArticle.caput = 'Conteúdo histórico que deve ser restaurado.';
  initial.children.push(secondArticle);
  initial.totalArtigos = 2;
  const fixture = await createPublicationAuditFixture({ initialAst: initial });
  try {
    const sql = createDisposableAuditSql(fixture.containerName);
    const directory = fixture.manifest.law.directoryName;
    const publish = (candidate: { publicationId: string; candidateSha: string }) =>
      fixture.publisher.publish(token, {
        publicationId: candidate.publicationId,
        candidateSha: candidate.candidateSha,
      });
    if (!fixture.database.baselines.getHistoricalVersion)
      throw new Error('Historical reader unavailable.');
    const historical = await fixture.database.baselines.getHistoricalVersion(
      fixture.lawId,
      fixture.publishedVersionId,
      directory,
    );
    expect(historical?.ast).toEqual(fixture.ast);
    const makeCandidate = async (options: {
      ast: IdentifiedNormaAST;
      previousAst: IdentifiedNormaAST;
      baseSha: string;
      baseVersionId: string;
      publicationNumber: number;
      kind: 'legislative_update' | 'rollback';
      previousUpdate: string;
      sourceSnapshots?: PublicationManifest['sourceSnapshots'];
    }) => {
      await fixture.gitCommand(fixture.work, ['switch', '--detach', options.baseSha]);
      // Only the disposable fixture worktree is cleaned between rejected candidates.
      await fixture.gitCommand(fixture.work, ['clean', '-fd']);
      const formatted = formatar(options.ast);
      if (!formatted.ok) throw new Error('Invalid rollback fixture.');
      const publicationId = randomUUID();
      const changelog: PublicationManifest['changelog'] = {
        publicationDate: '2026-10-08',
        version: options.ast.versaoVinculex,
        publicationNumber: options.publicationNumber,
        kind: options.kind,
        sourceSummary: 'Fontes históricas verificadas.',
        changes: deriveStructuredChanges(options.previousAst, options.ast),
        ...(options.kind === 'rollback'
          ? {
              restoredVersion: '1.0.0',
              rollbackJustification: 'Restaurar a publicação histórica conferida.',
            }
          : {}),
      };
      const update = `${generateUpdateMarkdown([changelog]).trimEnd()}\n\n${options.previousUpdate.slice('# Atualizações\n\n'.length)}`;
      const astCanonical = serializeCanonicalJson(options.ast);
      const manifest: PublicationManifest = {
        ...fixture.manifest,
        publicationId,
        idempotencyKey: randomUUID(),
        target: {
          version: options.ast.versaoVinculex,
          publicationNumber: options.publicationNumber,
          kind: options.kind,
          impact: 'normative_projection',
          restoredVersionId: options.kind === 'rollback' ? fixture.publishedVersionId : null,
        },
        expectedBase: { gitCommitSha: options.baseSha, publishedVersionId: options.baseVersionId },
        artifacts: {
          markdownSha256: hash(formatted.valor),
          updateMarkdownSha256: hash(update),
          identifiedAstSha256: hash(astCanonical),
        },
        sourceSnapshots: options.sourceSnapshots ?? fixture.manifest.sourceSnapshots,
        changelog,
      };
      const canonical = serializePublicationManifest(manifest);
      await Promise.all([
        writeFile(join(fixture.work, fixture.markdownRelativePath), formatted.valor),
        writeFile(join(fixture.work, 'leis', directory, 'UPDATE.md'), update),
        writeFile(
          join(
            fixture.work,
            publicationManifestRelativePath(
              directory,
              options.publicationNumber,
              options.ast.versaoVinculex,
            ),
          ),
          canonical,
        ),
        writeFile(
          join(
            fixture.work,
            publicationIdentifiedAstRelativePath(
              directory,
              options.publicationNumber,
              options.ast.versaoVinculex,
            ),
          ),
          astCanonical,
        ),
      ]);
      const approval = await fixture.publisher.approve(token, {
        publicationId,
        manifestDigest: hash(canonical),
      });
      const journal = await commitAndPushPublicationCandidate({
        repositoryRoot: fixture.work,
        storageRoot: join(fixture.root, 'journal'),
        manifestCanonical: canonical,
        approval,
        markdownRelativePath: fixture.markdownRelativePath,
      });
      const candidateSha = getProvenPublicationState(journal).gitCommitSha;
      if (candidateSha === null) throw new Error('Candidate SHA unavailable.');
      return { publicationId, candidateSha, update };
    };

    const current = structuredClone(fixture.ast);
    current.versaoVinculex = '1.1.0';
    const added = structuredClone(current.children[1]);
    if (added?.tipo !== 'artigo') throw new Error('Expected an article fixture.');
    added.id = 'no-art-3';
    added.numero = '3';
    added.blockId = 'ldem-art-3';
    added.caput = 'Conteúdo posterior ausente na versão restaurada.';
    current.children[1] = added;
    current.idsDepreciados = [{ antigo: 'ldem-art-3', novo: 'ldem-art-1' }];
    const updateCandidate = await makeCandidate({
      ast: current,
      previousAst: fixture.ast,
      baseSha: fixture.candidateSha,
      baseVersionId: fixture.publishedVersionId,
      publicationNumber: 2,
      kind: 'legislative_update',
      previousUpdate: fixture.update,
    });
    const updated = await publish(updateCandidate);
    if (updated.publishedVersionId === null) throw new Error('Update was not published.');
    const restored = structuredClone(fixture.ast);
    restored.versaoVinculex = '1.2.0';
    restored.dataFormatacaoVinculex = '2026-10-08';
    restored.dataVerificacaoIntegridade = '2026-10-08';
    restored.idsDepreciados = current.idsDepreciados;
    const rollbackOptions = {
      previousAst: current,
      baseSha: updateCandidate.candidateSha,
      baseVersionId: updated.publishedVersionId,
      publicationNumber: 3,
      kind: 'rollback' as const,
      previousUpdate: updateCandidate.update,
    };

    // Historical reservations cannot be recycled by an ordinary publication.
    const recycled = await makeCandidate({
      ...rollbackOptions,
      kind: 'legislative_update',
      ast: restored,
    });
    await expect(publish(recycled)).rejects.toMatchObject({ code: 'legal_validation_failed' });
    expect(await fixture.repository.getCanonicalSha()).toBe(updateCandidate.candidateSha);

    for (const mutation of ['legal_text', 'block_id', 'source_metadata', 'redirect'] as const) {
      const forged = structuredClone(restored);
      let snapshots = fixture.manifest.sourceSnapshots;
      const article = forged.children[1];
      if (article?.tipo !== 'artigo') throw new Error('Expected an article fixture.');
      if (mutation === 'legal_text') article.caput = 'Conteúdo inventado, com hashes válidos.';
      if (mutation === 'block_id') {
        article.numero = '4';
        article.blockId = 'ldem-art-4';
      }
      if (mutation === 'source_metadata')
        snapshots = snapshots.map((snapshot) => ({
          ...snapshot,
          capturedAt: '2026-10-08T12:00:00.000Z',
        }));
      if (mutation === 'redirect') forged.idsDepreciados = [];
      const candidate = await makeCandidate({
        ...rollbackOptions,
        ast: forged,
        sourceSnapshots: snapshots,
      });
      await expect(publish(candidate)).rejects.toMatchObject({
        code: 'legal_validation_failed',
      });
      expect(await fixture.repository.getCanonicalSha()).toBe(updateCandidate.candidateSha);
      const attempts = await sql.query<{ count: string }>(
        'select count(*)::text as count from public.publicacoes where id=$1::uuid',
        [candidate.publicationId],
      );
      expect(attempts[0]?.count).toBe('0');
    }
    const candidate = await makeCandidate({ ...rollbackOptions, ast: restored });
    const rolledBack = await publish(candidate);
    expect(rolledBack.publicationAttemptStatus).toBe('published');
    expect((await publish(candidate)).publishedVersionId).toBe(rolledBack.publishedVersionId);
    const baseline = await fixture.database.baselines.getByLawId(fixture.lawId, directory);
    expect(baseline.ast).toEqual(restored);
    expect(baseline.historicalBlockIds).toEqual(['ldem-art-1', 'ldem-art-2', 'ldem-art-3']);
    expect(baseline.redirects).toEqual(current.idsDepreciados);
    expect(
      await fixture.database.baselines.getHistoricalVersion(
        fixture.lawId,
        fixture.publishedVersionId,
        directory,
      ),
    ).toEqual(historical);
    const events = await sql.query<{ count: string }>(
      'select count(*)::text as count from private.publication_events where publication_id=$1::uuid and event_type=$2::text',
      [candidate.publicationId, 'published'],
    );
    expect(events[0]?.count).toBe('1');
  } finally {
    await fixture.close();
  }
});
