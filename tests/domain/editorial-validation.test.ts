import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  approveEditorialRevision,
  identifiedMinima,
  isEditorialApprovalCurrent,
  runEditorialValidation,
} from '@lex-editor/legal-domain';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const options = (overrides: Partial<Parameters<typeof runEditorialValidation>[1]> = {}) => ({
  mode: 'full' as const,
  journalSequence: 0,
  validatedAt: '2026-08-10T13:00:00.000-03:00',
  sha256,
  ...overrides,
});

const rangedFixture = (): unknown => {
  const ranged = clone(identifiedMinima);
  const article = ranged.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
  ranged.children = [
    {
      tipo: 'capitulo',
      id: 'no-capitulo-intervalo',
      ordem: 0,
      sourceRef: article.sourceRef,
      parseEvidence: article.parseEvidence,
      deviceStatus: 'active',
      numero: 'I',
      titulo: 'Arts. 1 a 999',
      children: [article],
    },
  ];
  return ranged;
};

describe('validação editorial consolidada', () => {
  it('aprova somente relatório completo, limpo e ligado à sequência atual', () => {
    const report = runEditorialValidation(identifiedMinima, options({ journalSequence: 4 }));
    const approved = approveEditorialRevision(
      report,
      '66666666-6666-4666-8666-666666666666',
      'editor-local-01',
      '2026-08-10T13:01:00.000-03:00',
    );

    expect(report).toMatchObject({
      isComplete: true,
      blockingCount: 0,
      unconfirmedWarningCount: 0,
      canApprove: true,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok || report.revisionHash === null) return;
    expect(isEditorialApprovalCurrent(approved.approval, report.revisionHash, 4)).toBe(true);
    expect(isEditorialApprovalCurrent(approved.approval, report.revisionHash, 5)).toBe(false);
  });

  it('localiza Block ID duplicado e nunca produz sucesso para AST inválida', () => {
    const invalid = clone(identifiedMinima);
    const article = invalid.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    const duplicated = clone(article);
    duplicated.id = 'no-art-2';
    duplicated.numero = '2';
    duplicated.ordem = 1;
    invalid.children.push(duplicated);
    invalid.totalArtigos = 2;

    const report = runEditorialValidation(invalid, options());

    expect(report.revisionHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.canApprove).toBe(false);
    expect(
      report.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'block_id_duplicado' &&
          diagnostic.severity === 'error' &&
          diagnostic.blocksApproval &&
          diagnostic.blocksExport &&
          diagnostic.location.nodeId === duplicated.id,
      ),
    ).toBe(true);
  });

  it('bloqueia as regras estruturais críticas com códigos estáveis e localização', () => {
    const missingMetadata = clone(identifiedMinima) as unknown as Record<string, unknown>;
    delete missingMetadata['titulo'];

    const emptyText = clone(identifiedMinima);
    const emptyArticle = emptyText.children[0];
    if (emptyArticle?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    emptyArticle.caput = '   ';

    const inconsistentCount = clone(identifiedMinima);
    inconsistentCount.totalArtigos = 99;

    const undecidedRevocation = clone(identifiedMinima);
    const revokedArticle = undecidedRevocation.children[0];
    if (revokedArticle?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    revokedArticle.deviceStatus = 'revoked';

    const cases: readonly (readonly [unknown, string])[] = [
      [missingMetadata, 'schema_invalido'],
      [emptyText, 'texto_obrigatorio'],
      [inconsistentCount, 'total_artigos_divergente'],
      [undecidedRevocation, 'revogacao_sem_decisao'],
    ];

    for (const [ast, expectedCode] of cases) {
      const report = runEditorialValidation(ast, options());
      const diagnostic = report.diagnostics.find(({ code }) => code === expectedCode);
      expect(diagnostic, expectedCode).toMatchObject({
        severity: 'error',
        blocksApproval: true,
        blocksExport: true,
      });
      expect(diagnostic?.location.astPath.length, expectedCode).toBeGreaterThan(0);
      expect(report).toMatchObject({ canApprove: false, isComplete: true });
    }
  });

  it('bloqueia Markdown divergente da AST mesmo quando a árvore é válida', () => {
    const report = runEditorialValidation(
      identifiedMinima,
      options({ renderedMarkdown: '# conteúdo editado fora do Formatter\n' }),
    );

    expect(report.canApprove).toBe(false);
    expect(
      report.diagnostics.some(({ blocksApproval, blocksExport }) => blocksApproval && blocksExport),
    ).toBe(true);
  });

  it('bloqueia interpretação de baixa confiança na validação incremental e completa', () => {
    const pending = clone(identifiedMinima);
    const article = pending.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.parseEvidence = {
      confidence: 'low',
      reasons: ['ambiguous_designator'],
      requiresHumanReview: true,
    };

    const incremental = runEditorialValidation(
      pending,
      options({ mode: 'incremental', changedNodeIds: [article.id], journalSequence: 2 }),
    );
    const full = runEditorialValidation(pending, options({ journalSequence: 2 }));

    expect(incremental).toMatchObject({ isComplete: false, canApprove: false, blockingCount: 1 });
    expect(incremental.diagnostics[0]).toMatchObject({
      code: 'human_review_required',
      location: { nodeId: article.id, blockId: article.blockId },
    });
    expect(full).toMatchObject({ isComplete: true, canApprove: false, blockingCount: 1 });
  });

  it('exige confirmação do aviso ligada ao fingerprint da revisão atual', () => {
    const ranged = rangedFixture();

    const pending = runEditorialValidation(ranged, options());
    const warning = pending.diagnostics.find((item) => item.code === 'division_article_range');
    if (warning === undefined) throw new Error('Aviso de intervalo não produzido.');
    const confirmed = runEditorialValidation(
      ranged,
      options({ confirmedWarningFingerprints: new Set([warning.fingerprint]) }),
    );

    expect(pending).toMatchObject({
      blockingCount: 0,
      warningCount: 1,
      unconfirmedWarningCount: 1,
      canApprove: false,
    });
    expect(confirmed).toMatchObject({
      warningCount: 1,
      unconfirmedWarningCount: 0,
      canApprove: true,
    });
    expect(
      confirmed.diagnostics.find((item) => item.fingerprint === warning.fingerprint),
    ).toMatchObject({ confirmed: true });
  });

  it('recusa aprovação com validação parcial ou aviso pendente', () => {
    const partial = runEditorialValidation(
      identifiedMinima,
      options({ mode: 'incremental', changedNodeIds: ['no-art-1'] }),
    );
    const ranged = rangedFixture();
    const warning = runEditorialValidation(ranged, options());

    expect(
      approveEditorialRevision(
        partial,
        '66666666-6666-4666-8666-666666666666',
        'editor-local-01',
        '2026-08-10T13:01:00.000-03:00',
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation_incomplete' } });
    expect(
      approveEditorialRevision(
        warning,
        '66666666-6666-4666-8666-666666666666',
        'editor-local-01',
        '2026-08-10T13:01:00.000-03:00',
      ),
    ).toMatchObject({ ok: false, error: { code: 'unconfirmed_warnings' } });
  });
});
