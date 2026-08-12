import { createHash } from 'node:crypto';

import {
  calculateNormativeHash,
  canonicalizeNormativeProjection,
  createLegislativeDetectionHashes,
  identifiedMinima,
  mesclarFontes,
  normalizeEditorialReferenceText,
  origemHistorica,
  origemMinima,
  parsedMinima,
  projectNormativeAst,
  reconciliar,
  registrarPublicacao,
  type SourceSnapshot,
} from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const snapshot = (content: string, reference: SourceSnapshot['referencia']): SourceSnapshot => {
  const digest = sha256(content);
  return {
    sha256: digest,
    conteudo: content,
    referencia: { ...reference, sourceArtifactSha256: digest },
  };
};

describe('projeção normativa para detecção legislativa', () => {
  it('produz o mesmo hash antes e depois da atribuição de identidade técnica', () => {
    expect(calculateNormativeHash(parsedMinima, sha256)).toBe(
      calculateNormativeHash(identifiedMinima, sha256),
    );
    const canonical = canonicalizeNormativeProjection(identifiedMinima);
    expect(canonical).not.toContain('blockId');
    expect(canonical).not.toContain('sourceRef');
    expect(canonical).not.toContain('parseEvidence');
    expect(canonical).not.toContain('astPhase');
    expect(canonical).not.toContain('no-art-1');
  });

  it('ignora ruído cosmético, evidência, histórico e metadados operacionais', () => {
    const cosmetic = clone(parsedMinima);
    cosmetic.id = 'outro-id-interno';
    cosmetic.publicationStatus = 'review';
    cosmetic.dataFormatacaoVinculex = '2030-01-01';
    cosmetic.dataVerificacaoIntegridade = '2030-01-02';
    cosmetic.sourceRef.cssSelector = '#layout-novo';
    cosmetic.parseEvidence.confidence = 'medium';
    const article = cosmetic.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.caput = '  Esta\u00a0lei\u200b demonstra   o contrato da NormaAST. ';
    article.redacoesAnteriores = [{ texto: 'Histórico auxiliar recém-capturado.' }];

    expect(calculateNormativeHash(cosmetic, sha256)).toBe(
      calculateNormativeHash(parsedMinima, sha256),
    );
  });

  it('remove HTML, realces, Markdown e Block IDs de referência editorial pessoal', () => {
    const decorated =
      '<span class="marca"><mark>**Art. 61.**</mark> Texto ==vigente==.</span> ^meu-id';
    expect(normalizeEditorialReferenceText(decorated)).toBe('Art. 61. Texto vigente.');
  });

  it('preserva somente o label visível de wikilinks pessoais do Obsidian', () => {
    expect(
      normalizeEditorialReferenceText(
        '* § 4º trata do [[#^id-pessoal|<mark>§ 3º</mark>]] e do ' +
          '[[NavegaLei/CF#^outro-id|**caput do art. 37**]]. ^linha-pessoal',
      ),
    ).toBe('§ 4º trata do § 3º e do caput do art. 37.');
  });

  it.each([
    [
      'texto',
      (ast: typeof parsedMinima) => {
        const article = ast.children[0];
        if (article?.tipo === 'artigo') article.caput = 'Conteúdo juridicamente diferente.';
      },
    ],
    [
      'vigência',
      (ast: typeof parsedMinima) => {
        ast.legalStatus = 'revogada';
      },
    ],
    [
      'estado do dispositivo',
      (ast: typeof parsedMinima) => {
        const article = ast.children[0];
        if (article?.tipo === 'artigo') article.deviceStatus = 'amended';
      },
    ],
  ])('muda quando muda %s', (_label, mutate) => {
    const changed = clone(parsedMinima);
    mutate(changed);
    expect(calculateNormativeHash(changed, sha256)).not.toBe(
      calculateNormativeHash(parsedMinima, sha256),
    );
  });

  it('preserva pontuação potencialmente jurídica durante a normalização', () => {
    const changed = clone(parsedMinima);
    const article = changed.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.caput = article.caput.replace('.', ';');
    expect(calculateNormativeHash(changed, sha256)).not.toBe(
      calculateNormativeHash(parsedMinima, sha256),
    );
  });

  it('expõe uma projeção validada sem campos editoriais ou de proveniência', () => {
    expect(projectNormativeAst(identifiedMinima)).toEqual({
      schemaVersion: 1,
      tipo: 'lei',
      legalStatus: 'vigente',
      children: [
        {
          tipo: 'artigo',
          ordem: 0,
          deviceStatus: 'active',
          numero: '1',
          caput: 'Esta lei demonstra o contrato da NormaAST.',
          children: [],
        },
      ],
    });
  });
});

describe('sinais que exigem intervenção humana', () => {
  it('bloqueia conflito entre texto vigente primário e fonte histórica', () => {
    const historical = clone(parsedMinima);
    historical.sourceRef = { ...origemHistorica };
    const article = historical.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.sourceRef = { ...origemHistorica };
    article.caput = 'A fonte auxiliar apresenta outro texto vigente.';

    const merged = mesclarFontes(parsedMinima, [historical]);
    expect(merged.ok).toBe(false);
    if (!merged.ok) expect(merged.problemas[0]?.codigo).toBe('conflito_de_fontes');
  });

  it('recusa identidade ambígua antes de gerar diff', () => {
    const candidate = clone(identifiedMinima);
    const article = candidate.children[0];
    if (article === undefined) throw new Error('Fixture sem artigo.');
    candidate.children.push({ ...clone(article), id: 'artigo-duplicado', ordem: 1 });
    candidate.totalArtigos = 2;

    const result = reconciliar(
      candidate,
      registrarPublicacao(identifiedMinima, identifiedMinima.sigla),
      identifiedMinima.sigla,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problemas[0]?.codigo).toBe('block_id_duplicado');
  });
});

describe('hashes brutos do conjunto de fontes', () => {
  it('recalcula cada artefato, ordena o inventário e separa o hash normativo', () => {
    const primary = snapshot('<html>fonte compilada</html>', origemMinima);
    const historical = snapshot('<html>fonte anotada</html>', origemHistorica);
    const first = createLegislativeDetectionHashes({
      snapshots: [historical, primary],
      ast: parsedMinima,
      sha256,
    });
    const reordered = createLegislativeDetectionHashes({
      snapshots: [primary, historical],
      ast: identifiedMinima,
      sha256,
    });
    expect(first.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    if (!first.ok || !reordered.ok) return;
    expect(first.valor).toEqual(reordered.valor);
    expect(first.valor.sourceArtifacts).toHaveLength(2);
    expect(first.valor.sourceArtifacts.map((artifact) => artifact.artifactSha256)).toContain(
      primary.sha256,
    );
    expect(first.valor.normativeSha256).toBe(calculateNormativeHash(parsedMinima, sha256));
    expect(JSON.stringify(first.valor)).not.toContain('fonte compilada');
  });

  it('muda o inventário bruto sem criar mudança normativa falsa', () => {
    const before = createLegislativeDetectionHashes({
      snapshots: [snapshot('<html class="antigo">texto igual</html>', origemMinima)],
      ast: parsedMinima,
      sha256,
    });
    const after = createLegislativeDetectionHashes({
      snapshots: [snapshot('<html class="novo">texto igual</html>', origemMinima)],
      ast: parsedMinima,
      sha256,
    });
    expect(before.ok).toBe(true);
    expect(after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(before.valor.sourceArtifacts).not.toEqual(after.valor.sourceArtifacts);
    expect(before.valor.normativeSha256).toBe(after.valor.normativeSha256);
  });

  it('recusa conteúdo que não corresponde ao hash e digest inválido', () => {
    const invalid = snapshot('conteúdo original', origemMinima);
    const tampered = { ...invalid, conteudo: 'conteúdo adulterado' };
    const mismatch = createLegislativeDetectionHashes({
      snapshots: [tampered],
      ast: parsedMinima,
      sha256,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.problemas[0]?.caminho).toEqual(['snapshots', 0, 'sha256']);
    }
    expect(
      createLegislativeDetectionHashes({
        snapshots: [invalid],
        ast: parsedMinima,
        sha256: () => 'inválido',
      }).ok,
    ).toBe(false);
  });

  it('recusa fonte primária ausente e artefato duplicado', () => {
    const historical = snapshot('histórico', origemHistorica);
    expect(
      createLegislativeDetectionHashes({ snapshots: [historical], ast: parsedMinima, sha256 }).ok,
    ).toBe(false);

    const primary = snapshot('primária', origemMinima);
    const crossCheck = snapshot('histórico repetido', origemHistorica);
    const duplicate = createLegislativeDetectionHashes({
      snapshots: [primary, crossCheck, clone(crossCheck)],
      ast: parsedMinima,
      sha256,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.problemas[0]?.codigo).toBe('manifesto_invalido');
      expect(duplicate.problemas[0]?.caminho).toEqual(['snapshots', 2]);
    }
  });
});
