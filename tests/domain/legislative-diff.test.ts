import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createLegislativeStructuralDiff,
  origemMinima,
  processar,
  reconciliar,
  registrarPublicacao,
  type IdentifiedNormaAST,
  type LegislativeStructuralDiff,
  type MetadadosDaNorma,
  type SourceReference,
} from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

const FIXTURES = fileURLToPath(new URL('../../fixtures/legal/updates/', import.meta.url));
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

interface FixtureManifest extends MetadadosDaNorma {
  readonly capturadoEm: string;
  readonly sourceType: SourceReference['sourceType'];
  readonly sourceRole: SourceReference['sourceRole'];
  readonly sourceVariant: SourceReference['sourceVariant'];
  readonly fonteAnotada?: string;
  readonly snapshotSha256: Readonly<Record<string, string>>;
}

const fixture = (law: string, file: string): string =>
  readFileSync(join(FIXTURES, law, file), 'utf8');

const manifest = (law: string): FixtureManifest =>
  JSON.parse(fixture(law, 'manifesto.json')) as FixtureManifest;

const metadata = (value: FixtureManifest): MetadadosDaNorma => ({
  titulo: value.titulo,
  sigla: value.sigla,
  tipoNorma: value.tipoNorma,
  numero: value.numero,
  ano: value.ano,
  ramo: value.ramo,
  fonte: value.fonte,
  dataPublicacao: value.dataPublicacao,
  dataAtualizacaoLegal: value.dataAtualizacaoLegal,
  dataFormatacaoVinculex: value.dataFormatacaoVinculex,
  dataVerificacaoIntegridade: value.dataVerificacaoIntegridade,
  versaoVinculex: value.versaoVinculex,
  legalStatus: value.legalStatus,
  publicationStatus: value.publicationStatus,
});

const treeFrom = (
  law: string,
  file: string,
  referenceOverrides: Partial<SourceReference> = {},
): IdentifiedNormaAST => {
  const source = manifest(law);
  const content = fixture(law, file);
  const artifactSha = sha256(content);
  expect(source.snapshotSha256[file]).toBe(artifactSha);
  const result = processar({
    conteudo: content,
    referenciaBase: {
      ...origemMinima,
      sourceType: source.sourceType,
      sourceRole: source.sourceRole,
      sourceVariant: source.sourceVariant,
      sourceUrl: source.fonte,
      sourceArtifactSha256: artifactSha,
      fragmentSha256: artifactSha,
      ...referenceOverrides,
    },
    hashDaLinha: sha256,
    metadados: metadata(source),
  });
  if (!result.relatorio.ok || result.arvore === undefined) {
    throw new Error(
      `Fixture ${law}/${file} inválida: ${JSON.stringify(result.relatorio.ok ? [] : result.relatorio.problemas)}`,
    );
  }
  return result.arvore;
};

const diffFrom = (
  law: string,
  beforeFile: string,
  afterFile: string,
  explicitRenumberings: Parameters<
    typeof createLegislativeStructuralDiff
  >[0]['explicitRenumberings'] = [],
): LegislativeStructuralDiff => {
  const before = treeFrom(law, beforeFile);
  const candidate = treeFrom(law, afterFile);
  const reconciled = reconciliar(
    candidate,
    registrarPublicacao(before, manifest(law).sigla),
    manifest(law).sigla,
  );
  if (!reconciled.ok) throw new Error(JSON.stringify(reconciled.problemas));
  const result = createLegislativeStructuralDiff({
    previous: before,
    current: reconciled.valor.arvore,
    explicitRenumberings,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problemas));
  return result.valor;
};

describe('diff estrutural legislativo', () => {
  it('carrega texto, caminho, estado e confiança em cada lado', () => {
    const diff = diffFrom('l9099', 'before.txt', 'after.txt');
    const article61 = diff.entries.find(
      ({ affectedBlockId }) => affectedBlockId === 'l9099-art-61',
    );
    expect(article61).toMatchObject({
      category: 'amended',
      resultingDeviceStatus: 'amended',
      confidence: 'high',
      requiresHumanReview: false,
      before: { blockId: 'l9099-art-61', deviceStatus: 'active' },
      after: { blockId: 'l9099-art-61', deviceStatus: 'amended' },
    });
    expect(article61?.before?.text).toContain('não superior a um ano');
    expect(article61?.after?.text).toContain('2 (dois) anos');
    expect(article61?.after?.path.at(-1)).toMatchObject({
      tipo: 'artigo',
      label: 'Art. 61',
    });
  });

  it('não confunde alteração dos arts. 61 e 62 da Lei 9.099 com revogação', () => {
    const diff = diffFrom('l9099', 'before.txt', 'after.txt');
    expect(diff.summary).toEqual({
      unchanged: 0,
      amended: 2,
      included: 0,
      revoked: 0,
      renumbered: 0,
      missingPublished: 0,
    });
    expect(diff.entries.map(({ category }) => category).every((value) => value === 'amended')).toBe(
      true,
    );
  });

  it('classifica alteração, inclusão, revogação e renumeração explícita na Lei 9.605', () => {
    const diff = diffFrom('l9605', 'before.txt', 'after.txt', [
      {
        fromBlockId: 'l9605-art-65-par-unico',
        toBlockId: 'l9605-art-65-par-1',
        evidence: 'Renumerado do parágrafo único pela Lei nº 12.408, de 2011',
      },
    ]);
    expect(diff.summary).toEqual({
      unchanged: 0,
      amended: 4,
      included: 1,
      revoked: 1,
      renumbered: 1,
      missingPublished: 0,
    });
    expect(diff.entries.find(({ category }) => category === 'renumbered')).toMatchObject({
      category: 'renumbered',
      affectedBlockId: 'l9605-art-65-par-unico',
      before: { blockId: 'l9605-art-65-par-unico' },
      after: { blockId: 'l9605-art-65-par-1' },
      renumberingEvidence: 'Renumerado do parágrafo único pela Lei nº 12.408, de 2011',
    });
    expect(diff.entries.find(({ category }) => category === 'included')).toMatchObject({
      category: 'included',
      after: { blockId: 'l9605-art-65-par-2' },
    });
    expect(diff.entries).toContainEqual(
      expect.objectContaining({
        category: 'revoked',
        affectedBlockId: 'l9605-art-67-par-unico',
      }),
    );
  });

  it('usa o recorte compilado da Lei 10.826 para texto vigente e novos dispositivos', () => {
    const diff = diffFrom('l10826', 'before.txt', 'after-compiled.txt');
    expect(diff.summary).toEqual({
      unchanged: 2,
      amended: 2,
      included: 3,
      revoked: 0,
      renumbered: 0,
      missingPublished: 0,
    });
    expect(
      diff.entries.find(({ affectedBlockId }) => affectedBlockId === 'l10826-art-5')?.after?.text,
    ).toContain('local de trabalho');
    expect(
      diff.entries
        .filter(({ category }) => category === 'included')
        .map(({ after }) => after?.blockId),
    ).toEqual(['l10826-art-5-par-4', 'l10826-art-5-par-4-inc-i', 'l10826-art-5-par-4-inc-ii']);
  });

  it('aceita o recorte anotado da Lei 10.826 sem expor redação anterior no lado atual', () => {
    const source = manifest('l10826');
    const before = treeFrom('l10826', 'before.txt');
    const annotated = treeFrom('l10826', 'after-annotated.txt', {
      sourceRole: 'historical_auxiliary',
      sourceVariant: 'annotated',
      sourceUrl: source.fonteAnotada,
    });
    const reconciled = reconciliar(
      annotated,
      registrarPublicacao(before, source.sigla),
      source.sigla,
    );
    if (!reconciled.ok) throw new Error(JSON.stringify(reconciled.problemas));
    const result = createLegislativeStructuralDiff({
      previous: before,
      current: reconciled.valor.arvore,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const article = result.valor.entries.find(
      ({ affectedBlockId }) => affectedBlockId === 'l10826-art-5',
    );
    expect(article?.after?.text).toContain('local de trabalho');
    expect(article?.after?.text).not.toContain('dependência desses, desde que');
  });

  it('não converte ausência em revogação e exige evidência coerente para renumeração', () => {
    const before = treeFrom('l9099', 'before.txt');
    const current = structuredClone(before);
    current.children.pop();
    current.totalArtigos = 1;
    const missing = createLegislativeStructuralDiff({ previous: before, current });
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.valor.summary.revoked).toBe(0);
    expect(missing.valor.missingPublished.map(({ blockId }) => blockId)).toEqual(['l9099-art-62']);
    expect(missing.valor.requiresHumanReview).toBe(true);

    const invalidRenumbering = createLegislativeStructuralDiff({
      previous: before,
      current: before,
      explicitRenumberings: [
        {
          fromBlockId: 'l9099-art-61',
          toBlockId: 'l9099-art-62',
          evidence: 'Sem nota oficial de renumeração',
        },
      ],
    });
    expect(invalidRenumbering.ok).toBe(false);
    if (!invalidRenumbering.ok) {
      expect(invalidRenumbering.problemas[0]?.codigo).toBe('decisao_editorial_invalida');
    }
  });

  it('mantém mudança apenas histórica como inalterada e propaga baixa confiança', () => {
    const previous = treeFrom('l9099', 'after.txt');
    const current = structuredClone(previous);
    const article = current.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.redacoesAnteriores = [{ texto: 'Redação histórica auxiliar recém-capturada.' }];
    article.sourceRef = { ...article.sourceRef, cssSelector: '#novo-layout' };
    article.parseEvidence = {
      confidence: 'low',
      reasons: ['ambiguous_designator'],
      requiresHumanReview: true,
    };

    const result = createLegislativeStructuralDiff({ previous, current });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.valor.summary.amended).toBe(0);
    expect(result.valor.summary.unchanged).toBe(2);
    expect(result.valor.requiresHumanReview).toBe(true);
    expect(
      result.valor.entries.find(({ affectedBlockId }) => affectedBlockId === article.blockId),
    ).toMatchObject({
      category: 'unchanged',
      confidence: 'low',
      confidenceReasons: ['ambiguous_designator'],
      requiresHumanReview: true,
    });
  });
});
