import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
  publicationSourceSnapshotRelativePath,
  serializeCanonicalJson,
  serializePublicationManifest,
  type PublicationManifest,
} from '../../src/shared/publication/manifest.js';
import {
  createDisposableAuditSql,
  runDisposableSql,
} from './support/publication-audit-database.js';
import { createPublicationAuditFixture } from './support/publication-audit-fixture.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = 'disposable-editor-session';

test('publishing A then B then A keeps global Git ancestry independent of the law SQL baseline', async () => {
  test.setTimeout(60_000);
  const initial = structuredClone(identifiedMinima);
  const first = initial.children[0];
  if (first?.tipo !== 'artigo') throw new Error('Expected article fixture.');
  for (const number of [2, 3])
    initial.children.push({
      ...structuredClone(first),
      id: `no-art-${String(number)}`,
      ordem: number - 1,
      numero: String(number),
      blockId: `ldem-art-${String(number)}`,
    });
  initial.totalArtigos = 3;
  // Authoring order differs from the SQL reader's lexical redirect order.
  initial.idsDepreciados = [
    { antigo: 'ldem-art-3', novo: 'ldem-art-1' },
    { antigo: 'ldem-art-2', novo: 'ldem-art-1' },
  ];
  const fixture = await createPublicationAuditFixture({ initialAst: initial });
  try {
    const secondLawId = randomUUID();
    await runDisposableSql(
      fixture.containerName,
      `insert into public.leis(id,sigla,titulo,tipo,numero,ano,ramo,fonte_url,data_publicacao)
      values ('${secondLawId}','LTWO','Segunda lei','lei ordinária','2',2026,'teste','https://www.planalto.gov.br/','2026-08-10');`,
    );
    const source = fixture.manifest.sourceSnapshots[0];
    if (source === undefined) throw new Error('Snapshot unavailable.');
    const snapshot = await fixture.repository.readBlob(
      fixture.candidateSha,
      publicationSourceSnapshotRelativePath(
        fixture.manifest.law.directoryName,
        source.sourceArtifactSha256,
      ),
    );
    const candidate = async (options: {
      lawId: string;
      directoryName: string;
      ast: IdentifiedNormaAST;
      previousAst: IdentifiedNormaAST | null;
      parentSha: string;
      publishedVersionId: string | null;
      previousUpdate: string | null;
      publicationNumber: number;
    }) => {
      await fixture.gitCommand(fixture.work, ['switch', '--detach', options.parentSha]);
      await fixture.gitCommand(fixture.work, ['clean', '-fd']);
      const formatted = formatar(options.ast);
      if (!formatted.ok) throw new Error('Invalid law fixture.');
      const publicationId = randomUUID();
      const kind = options.publicationNumber === 1 ? 'initial' : 'legislative_update';
      const changelog: PublicationManifest['changelog'] = {
        publicationDate: '2026-10-08',
        version: options.ast.versaoVinculex,
        publicationNumber: options.publicationNumber,
        kind,
        sourceSummary: 'Fonte oficial conferida.',
        changes: deriveStructuredChanges(options.previousAst, options.ast),
      };
      const entry = generateUpdateMarkdown([changelog]);
      const update =
        options.previousUpdate === null
          ? entry
          : `${entry.trimEnd()}\n\n${options.previousUpdate.slice('# Atualizações\n\n'.length)}`;
      const astCanonical = serializeCanonicalJson(options.ast);
      const manifest: PublicationManifest = {
        ...fixture.manifest,
        publicationId,
        idempotencyKey: randomUUID(),
        law: { lawId: options.lawId, directoryName: options.directoryName },
        target: {
          version: options.ast.versaoVinculex,
          publicationNumber: options.publicationNumber,
          kind,
          impact: 'normative_projection',
          restoredVersionId: null,
        },
        expectedBase: {
          gitCommitSha: options.parentSha,
          publishedVersionId: options.publishedVersionId,
        },
        artifacts: {
          markdownSha256: hash(formatted.valor),
          updateMarkdownSha256: hash(update),
          identifiedAstSha256: hash(astCanonical),
        },
        changelog,
      };
      const canonical = serializePublicationManifest(manifest);
      const lawRoot = join(fixture.work, 'leis', options.directoryName);
      await mkdir(join(lawRoot, '.vinculex/releases'), { recursive: true });
      await mkdir(join(lawRoot, '.vinculex/sources'), { recursive: true });
      const markdownRelativePath = `leis/${options.directoryName}/${options.ast.sigla}.md`;
      await Promise.all([
        writeFile(join(fixture.work, markdownRelativePath), formatted.valor),
        writeFile(join(lawRoot, 'UPDATE.md'), update),
        writeFile(
          join(
            fixture.work,
            publicationManifestRelativePath(
              options.directoryName,
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
              options.directoryName,
              options.publicationNumber,
              options.ast.versaoVinculex,
            ),
          ),
          astCanonical,
        ),
        writeFile(
          join(
            fixture.work,
            publicationSourceSnapshotRelativePath(
              options.directoryName,
              source.sourceArtifactSha256,
            ),
          ),
          snapshot,
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
        markdownRelativePath,
      });
      const candidateSha = getProvenPublicationState(journal).gitCommitSha;
      if (candidateSha === null) throw new Error('Candidate SHA unavailable.');
      return { publicationId, candidateSha };
    };

    const secondAst = structuredClone(fixture.ast);
    secondAst.sigla = 'ltwo';
    secondAst.numero = '2';
    secondAst.titulo = 'Segunda lei';
    secondAst.idsDepreciados = [];
    for (const article of secondAst.children) {
      if (article.tipo !== 'artigo') throw new Error('Expected article fixture.');
      article.blockId = article.blockId.replace('ldem-', 'ltwo-');
    }
    const secondArticle = secondAst.children[0];
    if (secondArticle?.tipo !== 'artigo') throw new Error('Expected article fixture.');
    secondArticle.blockId = 'ltwo-art-1';
    secondArticle.caput = 'Conteúdo da segunda lei.';
    const secondCandidate = await candidate({
      lawId: secondLawId,
      directoryName: 'segunda-lei',
      ast: secondAst,
      previousAst: null,
      parentSha: fixture.candidateSha,
      publishedVersionId: null,
      previousUpdate: null,
      publicationNumber: 1,
    });
    const secondPublished = await fixture.publisher.publish(token, secondCandidate);
    expect(secondPublished.publicationAttemptStatus).toBe('published');
    if (secondPublished.publishedVersionId === null)
      throw new Error('Second law was not published.');

    const nextAst = structuredClone(fixture.ast);
    nextAst.versaoVinculex = '1.1.0';
    const changedArticle = nextAst.children[0];
    if (changedArticle?.tipo !== 'artigo') throw new Error('Expected article fixture.');
    changedArticle.caput = 'Redação da primeira lei atualizada após publicar a segunda.';
    const next = {
      lawId: fixture.lawId,
      directoryName: fixture.manifest.law.directoryName,
      ast: nextAst,
      previousAst: fixture.ast,
      parentSha: secondCandidate.candidateSha,
      publishedVersionId: fixture.publishedVersionId,
      previousUpdate: fixture.update,
      publicationNumber: 2,
    };
    const stalePointer = await candidate({
      ...next,
      publishedVersionId: secondPublished.publishedVersionId,
    });
    await expect(fixture.publisher.publish(token, stalePointer)).rejects.toMatchObject({
      code: 'sequence_conflict',
    });
    const staleGit = await candidate({ ...next, parentSha: fixture.candidateSha });
    await expect(fixture.publisher.publish(token, staleGit)).rejects.toMatchObject({
      code: 'canonical_base_changed',
    });
    expect(await fixture.repository.getCanonicalSha()).toBe(secondCandidate.candidateSha);
    const finalCandidate = await candidate(next);
    const firstUpdated = await fixture.publisher.publish(token, finalCandidate);
    expect(await fixture.repository.getParentSha(finalCandidate.candidateSha)).toBe(
      secondCandidate.candidateSha,
    );
    expect(firstUpdated.publicationAttemptStatus).toBe('published');
    const firstBaseline = await fixture.database.baselines.getByLawId(
      fixture.lawId,
      fixture.manifest.law.directoryName,
    );
    const secondBaseline = await fixture.database.baselines.getByLawId(secondLawId, 'segunda-lei');
    expect(firstBaseline.ast).toEqual(nextAst);
    expect(firstBaseline.publishedVersionId).toBe(firstUpdated.publishedVersionId);
    expect(secondBaseline.publishedVersionId).toBe(secondPublished.publishedVersionId);
    expect(secondBaseline.ast).toEqual(secondAst);
    const sql = createDisposableAuditSql(fixture.containerName);
    for (const rejected of [stalePointer, staleGit]) {
      const attempts = await sql.query<{ count: string }>(
        'select count(*)::text as count from public.publicacoes where id=$1::uuid',
        [rejected.publicationId],
      );
      expect(attempts[0]?.count).toBe('0');
    }
  } finally {
    await fixture.close();
  }
});
