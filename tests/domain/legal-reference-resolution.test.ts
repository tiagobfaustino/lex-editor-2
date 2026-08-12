import { createHash } from 'node:crypto';

import {
  createLegalNormCatalog,
  detectLegalReferences,
  identifiedMinima,
  legalNormCatalogSchema,
  legalReferenceDecisionSetSchema,
  normalizeLegalNormAlias,
  resolveLegalReferences,
  type IdentifiedNormaAST,
  type LegalReference,
  type LegalReferenceDecision,
  type LegalReferenceIndex,
  type LegalReferenceTarget,
} from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const nllcFixture = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = 'Lei nº 14.133, de 1º de abril de 2021';
  ast.sigla = 'NLLC';
  ast.tipoNorma = 'lei ordinária';
  ast.numero = '14.133';
  ast.ano = 2021;
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture mínima sem artigo.');
  article.blockId = 'nllc-art-1';
  article.caput = 'Esta Lei estabelece normas gerais de licitação.';
  const common = {
    sourceRef: article.sourceRef,
    parseEvidence: article.parseEvidence,
    deviceStatus: 'active' as const,
    children: [] as [],
  };
  article.children = [
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-3-node',
      ordem: 0,
      blockId: 'nllc-art-1-par-3',
      numero: '3',
      texto: 'Nas licitações serão observadas as condições legais.',
    },
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-4-node',
      ordem: 1,
      blockId: 'nllc-art-1-par-4',
      numero: '4',
      texto: 'A documentação de que trata o § 3º deste artigo será apresentada.',
    },
    {
      ...common,
      tipo: 'paragrafo',
      id: 'nllc-par-5-node',
      ordem: 2,
      blockId: 'nllc-art-1-par-5',
      numero: '5',
      texto: 'Aplicam-se os princípios previstos no caput do art. 37 da Constituição Federal.',
    },
  ];
  return ast;
};

const constitutionFixture = (year: 1988 | 1967 = 1988): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = `Constituição da República Federativa do Brasil de ${String(year)}`;
  ast.sigla = year === 1988 ? 'CF1988' : 'CF1967';
  ast.tipoNorma = 'constituição';
  ast.numero = String(year);
  ast.ano = year;
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture mínima sem artigo.');
  article.numero = '37';
  article.blockId = year === 1988 ? 'cf1988-art-37' : 'cf1967-art-37';
  article.caput = 'A administração pública obedecerá aos princípios constitucionais.';
  return ast;
};

const ordinaryLawFixture = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = 'Lei nº 9.099, de 26 de setembro de 1995';
  ast.sigla = 'L9099';
  ast.tipoNorma = 'lei ordinária';
  ast.numero = '9.099';
  ast.ano = 1995;
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture mínima sem artigo.');
  article.numero = '61';
  article.blockId = 'l9099-art-61';
  article.caput = 'Consideram-se infrações penais de menor potencial ofensivo.';
  return ast;
};

const detectedIndex = (source: IdentifiedNormaAST): LegalReferenceIndex => {
  const result = detectLegalReferences(source, { sha256 });
  if (!result.ok) throw new Error(JSON.stringify(result.problemas));
  return result.valor;
};

const catalog = (laws: readonly { ast: IdentifiedNormaAST; aliases?: readonly string[] }[]) => {
  const result = createLegalNormCatalog(laws, { sha256 });
  if (!result.ok) throw new Error(JSON.stringify(result.problemas));
  return result.valor;
};

const externalReference = (index: LegalReferenceIndex): LegalReference => {
  const reference = index.references.find(({ locator }) => locator.scope === 'external_law');
  if (reference === undefined) throw new Error('Fixture sem referência externa.');
  return reference;
};

const decisionFor = (
  index: LegalReferenceIndex,
  reference: LegalReference,
  action: 'keep_unlinked' | 'confirm_target',
  target?: LegalReferenceTarget,
): LegalReferenceDecision =>
  action === 'keep_unlinked'
    ? {
        schemaVersion: 1,
        action,
        referenceId: reference.referenceId,
        sourceRevisionHash: index.revisionHash,
        sourceBlockId: reference.sourceBlockId,
        sourceField: reference.sourceField,
        sourceSpan: reference.span,
        justification: 'Decisão revisada pelo editor jurídico.',
      }
    : {
        schemaVersion: 1,
        action,
        referenceId: reference.referenceId,
        sourceRevisionHash: index.revisionHash,
        sourceBlockId: reference.sourceBlockId,
        sourceField: reference.sourceField,
        sourceSpan: reference.span,
        justification: 'Alias confirmado contra a norma importada.',
        target:
          target ??
          (() => {
            throw new Error('Alvo obrigatório.');
          })(),
      };

describe('catálogo canônico de normas', () => {
  it('normaliza título, sigla e aliases sem usar nome de arquivo como identidade', () => {
    const cf = constitutionFixture();
    const first = catalog([{ ast: cf, aliases: ['Constituição Federal', 'CF', 'CF/88'] }]);
    const second = catalog([{ ast: cf, aliases: ['Constituição Federal', 'CF', 'CF/88'] }]);

    expect(first).toEqual(second);
    expect(legalNormCatalogSchema.safeParse(first).success).toBe(true);
    expect(first.entries[0]).toMatchObject({
      canonicalKey: 'constituição:1988:1988',
      law: { tipoNorma: 'constituição', numero: '1988', ano: 1988 },
      acronym: 'CF1988',
    });
    expect(first.entries[0]?.aliases.map(({ normalized }) => normalized)).toContain(
      normalizeLegalNormAlias('Constituição Federal'),
    );
    expect(first.entries[0]?.devices).toContainEqual({
      blockId: 'cf1988-art-37',
      point: { artigo: '37' },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.entries[0]?.aliases)).toBe(true);
    expect(normalizeLegalNormAlias('Lei nº 14.133/2021')).toBe(
      normalizeLegalNormAlias('Lei 14133/2021'),
    );
  });

  it('registra colisão de alias entre identidades distintas e recusa identidade duplicada', () => {
    const cf1988 = constitutionFixture(1988);
    const cf1967 = constitutionFixture(1967);
    const ambiguous = catalog([
      { ast: cf1988, aliases: ['Constituição Federal'] },
      { ast: cf1967, aliases: ['Constituição Federal'] },
    ]);
    const duplicated = createLegalNormCatalog([{ ast: cf1988 }, { ast: clone(cf1988) }], {
      sha256,
    });

    expect(ambiguous.collisions).toEqual([
      {
        normalizedAlias: 'constituicao federal',
        canonicalKeys: ['constituição:1967:1967', 'constituição:1988:1988'],
      },
    ]);
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.problemas[0]?.codigo).toBe('catalogo_juridico_invalido');
  });

  it('recusa chave, alias normalizado e relatório de colisões adulterados', () => {
    const valid = catalog([{ ast: constitutionFixture(), aliases: ['Constituição Federal'] }]);
    const entry = valid.entries[0];
    const alias = entry?.aliases[0];
    if (entry === undefined || alias === undefined) throw new Error('Fixture de catálogo vazia.');
    const wrongKey = {
      ...valid,
      entries: [{ ...entry, canonicalKey: 'constituição:1967:1967' }],
    };
    const wrongAlias = {
      ...valid,
      entries: [{ ...entry, aliases: [{ ...alias, normalized: 'alias adulterado' }] }],
    };
    const wrongCollisions = {
      ...valid,
      collisions: [
        ...valid.collisions,
        { normalizedAlias: 'inexistente', canonicalKeys: ['a', 'b'] },
      ],
    };

    expect(legalNormCatalogSchema.safeParse(wrongKey).success).toBe(false);
    expect(legalNormCatalogSchema.safeParse(wrongAlias).success).toBe(false);
    expect(legalNormCatalogSchema.safeParse(wrongCollisions).success).toBe(false);
  });
});

describe('resolução contextual por Block ID', () => {
  it('resolve o § 4º internamente e o § 5º para a CF/1988 importada', () => {
    const source = nllcFixture();
    const before = JSON.stringify(source);
    const index = detectedIndex(source);
    const cf = constitutionFixture();
    const legalCatalog = catalog([{ ast: cf, aliases: ['Constituição Federal', 'CF/88'] }]);
    const result = resolveLegalReferences(
      { sourceAst: source, index, catalog: legalCatalog },
      { sha256 },
    );

    expect(result.ok).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
    if (!result.ok) return;
    expect(result.valor.references).toHaveLength(2);
    const internal = result.valor.references.find(
      ({ sourceBlockId }) => sourceBlockId === 'nllc-art-1-par-4',
    );
    const external = result.valor.references.find(
      ({ sourceBlockId }) => sourceBlockId === 'nllc-art-1-par-5',
    );
    expect(internal).toMatchObject({
      state: 'resolved',
      target: { blockId: 'nllc-art-1-par-3' },
    });
    expect(external).toMatchObject({
      state: 'resolved',
      target: { blockId: 'cf1988-art-37' },
    });
    expect(Object.isFrozen(result.valor.references)).toBe(true);
  });

  it('re-resolve após importar a lei ausente sem alterar revisão, texto ou referenceId', () => {
    const source = nllcFixture();
    const original = JSON.stringify(source);
    const index = detectedIndex(source);
    const absent = resolveLegalReferences(
      { sourceAst: source, index, catalog: catalog([]) },
      { sha256 },
    );
    const present = resolveLegalReferences(
      {
        sourceAst: source,
        index,
        catalog: catalog([{ ast: constitutionFixture(), aliases: ['Constituição Federal'] }]),
      },
      { sha256 },
    );

    expect(absent.ok).toBe(true);
    expect(present.ok).toBe(true);
    if (!absent.ok || !present.ok) return;
    expect(externalReference(absent.valor)).toMatchObject({
      state: 'unresolved',
      reason: 'law_not_imported',
    });
    expect(externalReference(present.valor)).toMatchObject({
      state: 'resolved',
      target: { blockId: 'cf1988-art-37' },
    });
    expect(present.valor.revisionHash).toBe(absent.valor.revisionHash);
    expect(externalReference(present.valor).referenceId).toBe(
      externalReference(absent.valor).referenceId,
    );
    expect(JSON.stringify(source)).toBe(original);
  });

  it('resolve designação numerada contra a identidade canônica gerada pelo catálogo', () => {
    const source = nllcFixture();
    const article = source.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture mínima sem artigo.');
    const paragraph = article.children.find(
      (child) => child.tipo === 'paragrafo' && child.numero === '5',
    );
    if (paragraph?.tipo !== 'paragrafo') throw new Error('Fixture sem § 5º.');
    paragraph.texto = 'Aplica-se o art. 61 da Lei nº 9.099/1995.';
    const index = detectedIndex(source);
    const result = resolveLegalReferences(
      {
        sourceAst: source,
        index,
        catalog: catalog([{ ast: ordinaryLawFixture() }]),
      },
      { sha256 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(externalReference(result.valor)).toMatchObject({
      state: 'resolved',
      target: {
        law: { tipoNorma: 'lei ordinária', numero: '9.099', ano: 1995 },
        blockId: 'l9099-art-61',
      },
    });
  });

  it('não inventa alvo quando dispositivo está ausente e invalida aresta que ficou obsoleta', () => {
    const source = nllcFixture();
    const index = detectedIndex(source);
    const initial = resolveLegalReferences(
      {
        sourceAst: source,
        index,
        catalog: catalog([{ ast: constitutionFixture(), aliases: ['Constituição Federal'] }]),
      },
      { sha256 },
    );
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const removed = resolveLegalReferences(
      { sourceAst: source, index: initial.valor, catalog: catalog([]) },
      { sha256 },
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(externalReference(removed.valor)).toMatchObject({
      state: 'unresolved',
      severity: 'error',
      reason: 'stale_target',
    });
    expect(externalReference(removed.valor)).not.toHaveProperty('target');
  });

  it('emite ambiguidade bloqueante quando um alias alcança duas normas com o dispositivo', () => {
    const source = nllcFixture();
    const index = detectedIndex(source);
    const result = resolveLegalReferences(
      {
        sourceAst: source,
        index,
        catalog: catalog([
          { ast: constitutionFixture(1988), aliases: ['Constituição Federal'] },
          { ast: constitutionFixture(1967), aliases: ['Constituição Federal'] },
        ]),
      },
      { sha256 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(externalReference(result.valor)).toMatchObject({
      state: 'ambiguous',
      severity: 'error',
      reason: 'alias_collision',
      candidates: [
        expect.objectContaining({ blockId: 'cf1967-art-37' }),
        expect.objectContaining({ blockId: 'cf1988-art-37' }),
      ],
    });
  });
});

describe('decisões editoriais persistentes de referências', () => {
  it('confirma explicitamente um candidato ambíguo e sobrevive à serialização JSON', () => {
    const source = nllcFixture();
    const index = detectedIndex(source);
    const legalCatalog = catalog([
      { ast: constitutionFixture(1988), aliases: ['Constituição Federal'] },
      { ast: constitutionFixture(1967), aliases: ['Constituição Federal'] },
    ]);
    const ambiguous = resolveLegalReferences(
      { sourceAst: source, index, catalog: legalCatalog },
      { sha256 },
    );
    expect(ambiguous.ok).toBe(true);
    if (!ambiguous.ok) return;
    const reference = externalReference(ambiguous.valor);
    if (reference.state !== 'ambiguous') throw new Error('Esperada ambiguidade.');
    const target = reference.candidates.find(({ blockId }) => blockId === 'cf1988-art-37');
    if (target === undefined) throw new Error('Candidato CF/1988 ausente.');
    const decision = decisionFor(index, reference, 'confirm_target', target);
    const persisted: unknown = JSON.parse(JSON.stringify([decision]));
    const parsedDecisions = legalReferenceDecisionSetSchema.parse(persisted);

    expect(parsedDecisions).toEqual([decision]);
    const result = resolveLegalReferences(
      { sourceAst: source, index, catalog: legalCatalog, decisions: parsedDecisions },
      { sha256 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolved = externalReference(result.valor);
    expect(resolved).toMatchObject({
      state: 'resolved',
      target: { blockId: 'cf1988-art-37' },
    });
    expect(resolved.evidence.some(({ kind }) => kind === 'editorial_confirmation')).toBe(true);
  });

  it('permite manter a menção sem link e marca confirmação cujo alvo deixou de existir', () => {
    const source = nllcFixture();
    const index = detectedIndex(source);
    const cf = constitutionFixture();
    const legalCatalog = catalog([{ ast: cf, aliases: ['Constituição Federal'] }]);
    const reference = externalReference(index);
    const entry = legalCatalog.entries[0];
    if (entry === undefined) throw new Error('Catálogo sem lei.');
    const target = entry.devices[0];
    if (target === undefined) throw new Error('Catálogo sem alvo.');
    const keepUnlinked = resolveLegalReferences(
      {
        sourceAst: source,
        index,
        catalog: legalCatalog,
        decisions: [decisionFor(index, reference, 'keep_unlinked')],
      },
      { sha256 },
    );
    const confirmation = decisionFor(index, reference, 'confirm_target', {
      law: entry.law,
      revisionHash: entry.revisionHash,
      blockId: target.blockId,
    });
    const stale = resolveLegalReferences(
      { sourceAst: source, index, catalog: catalog([]), decisions: [confirmation] },
      { sha256 },
    );

    expect(keepUnlinked.ok).toBe(true);
    expect(stale.ok).toBe(true);
    if (!keepUnlinked.ok || !stale.ok) return;
    expect(externalReference(keepUnlinked.valor)).toMatchObject({
      state: 'unresolved',
      reason: 'editorially_unlinked',
      severity: 'warning',
    });
    expect(externalReference(stale.valor)).toMatchObject({
      state: 'unresolved',
      reason: 'stale_target',
      severity: 'error',
    });
  });

  it('recusa decisão adulterada que não corresponda exatamente à origem', () => {
    const source = nllcFixture();
    const index = detectedIndex(source);
    const reference = externalReference(index);
    const decision = decisionFor(index, reference, 'keep_unlinked');
    const result = resolveLegalReferences(
      {
        sourceAst: source,
        index,
        catalog: catalog([]),
        decisions: [{ ...decision, sourceBlockId: 'nllc-art-1-par-4' }],
      },
      { sha256 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problemas[0]?.codigo).toBe('decisao_referencia_invalida');
  });
});
