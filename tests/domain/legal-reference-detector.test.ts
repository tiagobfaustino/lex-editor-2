import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  detectLegalReferenceMentions,
  detectLegalReferences,
  identifiedMinima,
  legalReferenceIndexSchema,
  type IdentifiedNormaAST,
  type LegalReferencePoint,
} from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

interface PositiveCase {
  readonly name: string;
  readonly text: string;
  readonly mention: string;
  readonly scope: 'same_law' | 'external_law';
  readonly context?: 'same_article' | 'same_law';
  readonly lawMention?: string;
  readonly selectorKind: 'point' | 'list' | 'range';
  readonly points: readonly LegalReferencePoint[];
}

interface NegativeCase {
  readonly name: string;
  readonly text: string;
}

const matrix = JSON.parse(
  readFileSync(
    new URL('../../fixtures/legal/references/detection-cases.json', import.meta.url),
    'utf8',
  ),
) as { readonly positive: readonly PositiveCase[]; readonly negative: readonly NegativeCase[] };

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const pointsOf = (
  selector: ReturnType<typeof detectLegalReferenceMentions>[number]['locator']['selector'],
): readonly LegalReferencePoint[] => {
  if (selector.kind === 'point') return [selector.point];
  if (selector.kind === 'list') return selector.points;
  return [selector.from, selector.to];
};

const nllcFixture = (): IdentifiedNormaAST => {
  const ast = clone(identifiedMinima);
  ast.titulo = 'Lei nº 14.133/2021';
  ast.sigla = 'nllc';
  ast.tipoNorma = 'lei ordinária';
  ast.numero = '14.133';
  ast.ano = 2021;
  const article = ast.children[0];
  if (article?.tipo !== 'artigo') throw new Error('Fixture mínima sem artigo.');

  article.blockId = 'nllc-art-1';
  article.caput = 'Aplicam-se os arts. 142 e 144 da Constituição Federal.';
  const paragraphBase = {
    sourceRef: article.sourceRef,
    parseEvidence: article.parseEvidence,
    deviceStatus: 'active' as const,
    children: [] as [],
  };
  article.children = [
    {
      ...paragraphBase,
      tipo: 'paragrafo',
      id: 'nllc-art-1-par-3-node',
      ordem: 0,
      blockId: 'nllc-art-1-par-3',
      numero: '3',
      texto: 'Nas licitações podem ser admitidas condições específicas.',
    },
    {
      ...paragraphBase,
      tipo: 'paragrafo',
      id: 'nllc-art-1-par-4-node',
      ordem: 1,
      blockId: 'nllc-art-1-par-4',
      numero: '4',
      texto: 'A documentação relativa ao § 3º deste artigo será explícita.',
    },
    {
      ...paragraphBase,
      tipo: 'paragrafo',
      id: 'nllc-art-1-par-5-node',
      ordem: 2,
      blockId: 'nllc-art-1-par-5',
      numero: '5',
      texto: 'Observa-se o caput do art. 37 da Constituição Federal.',
    },
  ];
  return ast;
};

describe('gramática determinística de referências jurídicas', () => {
  for (const testCase of matrix.positive) {
    it(`detecta ${testCase.name}`, () => {
      const original = testCase.text;
      const detected = detectLegalReferenceMentions(testCase.text);

      expect(detected).toHaveLength(1);
      const mention = detected[0];
      expect(mention?.span.text).toBe(testCase.mention);
      expect(testCase.text.slice(mention?.span.start, mention?.span.end)).toBe(testCase.mention);
      expect(mention?.locator.scope).toBe(testCase.scope);
      expect(mention?.locator.selector.kind).toBe(testCase.selectorKind);
      expect(mention === undefined ? [] : pointsOf(mention.locator.selector)).toEqual(
        testCase.points,
      );
      if (mention?.locator.scope === 'same_law') {
        expect(mention.locator.context).toBe(testCase.context);
      } else if (mention?.locator.scope === 'external_law') {
        expect(mention.locator.lawMention).toBe(testCase.lawMention);
      }
      expect(testCase.text).toBe(original);
    });
  }

  for (const testCase of matrix.negative) {
    it(`não detecta ${testCase.name}`, () => {
      expect(detectLegalReferenceMentions(testCase.text)).toEqual([]);
    });
  }

  it('prefere a cadeia jurídica completa e não emite spans sobrepostos', () => {
    const text = 'Aplicam-se os incisos III e IV do § 2º do art. 121 desta Lei.';
    const detected = detectLegalReferenceMentions(text);

    expect(detected).toHaveLength(1);
    expect(detected[0]?.span.text).toBe('incisos III e IV do § 2º do art. 121');
    expect(detected[0]?.locator.selector).toEqual({
      kind: 'list',
      points: [
        { artigo: '121', paragrafo: '2', inciso: 'III' },
        { artigo: '121', paragrafo: '2', inciso: 'IV' },
      ],
    });
  });
});

describe('índice detectado a partir da IdentifiedNormaAST', () => {
  it('liga menções à revisão e aos campos sem alterar um byte da árvore', () => {
    const ast = nllcFixture();
    const before = JSON.stringify(ast);
    const first = detectLegalReferences(ast, { sha256 });
    const second = detectLegalReferences(ast, { sha256 });

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(JSON.stringify(ast)).toBe(before);
    if (!first.ok) return;

    expect(legalReferenceIndexSchema.safeParse(first.valor).success).toBe(true);
    expect(first.valor).toMatchObject({
      schemaVersion: 1,
      law: { tipoNorma: 'lei ordinária', numero: '14.133', ano: 2021 },
      analyzerVersion: '1.0.0',
    });
    expect(first.valor.references).toHaveLength(3);
    expect(Object.isFrozen(first.valor)).toBe(true);
    expect(Object.isFrozen(first.valor.references)).toBe(true);
    expect(Object.isFrozen(first.valor.references[0]?.locator)).toBe(true);
    expect(
      first.valor.references.map(({ sourceBlockId, sourceField, span }) => ({
        sourceBlockId,
        sourceField,
        text: span.text,
      })),
    ).toEqual([
      {
        sourceBlockId: 'nllc-art-1',
        sourceField: 'caput',
        text: 'arts. 142 e 144',
      },
      {
        sourceBlockId: 'nllc-art-1-par-4',
        sourceField: 'texto',
        text: '§ 3º',
      },
      {
        sourceBlockId: 'nllc-art-1-par-5',
        sourceField: 'texto',
        text: 'caput do art. 37',
      },
    ]);
    expect(new Set(first.valor.references.map(({ referenceId }) => referenceId)).size).toBe(3);
    expect(first.valor.references.every(({ state }) => state === 'detected')).toBe(true);
  });

  it('recusa AST que ainda não esteja identificada e função hash inválida', () => {
    const parsed = clone(identifiedMinima) as unknown as Record<string, unknown>;
    parsed['astPhase'] = 'parsed';

    const wrongPhase = detectLegalReferences(parsed, { sha256 });
    const badHash = detectLegalReferences(nllcFixture(), { sha256: () => 'inválido' });

    expect(wrongPhase.ok).toBe(false);
    expect(badHash.ok).toBe(false);
  });

  it('não analisa redações anteriores, notas ou títulos editoriais', () => {
    const ast = nllcFixture();
    const article = ast.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture mínima sem artigo.');
    article.redacoesAnteriores = [{ texto: 'Aplicava-se o art. 5º desta Lei.' }];
    article.notaStatus = 'Ver o art. 6º desta Lei.';
    ast.notasEditoriais = ['Ver o art. 7º desta Lei.'];

    const result = detectLegalReferences(ast, { sha256 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.valor.references).toHaveLength(3);
    expect(JSON.stringify(result.valor)).not.toContain('art. 5º');
    expect(JSON.stringify(result.valor)).not.toContain('art. 6º');
    expect(JSON.stringify(result.valor)).not.toContain('art. 7º');
  });
});
