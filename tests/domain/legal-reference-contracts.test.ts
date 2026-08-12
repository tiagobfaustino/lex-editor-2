import {
  legalReferenceIndexSchema,
  legalReferenceSchema,
  type LegalReferenceIndex,
} from '@lex-editor/legal-domain';
import { describe, expect, expectTypeOf, it } from 'vitest';

const NLLC = {
  tipoNorma: 'lei ordinária',
  numero: '14.133',
  ano: 2021,
} as const;

const CF1988 = {
  tipoNorma: 'constituição',
  numero: '1988',
  ano: 1988,
} as const;

const HASH_NLLC = 'a'.repeat(64);
const HASH_CF = 'b'.repeat(64);
const REFERENCE_INTERNAL = 'c'.repeat(64);
const REFERENCE_EXTERNAL = 'd'.repeat(64);

const span = (text: string, start = 0) => ({
  encoding: 'utf16' as const,
  start,
  end: start + text.length,
  text,
});

const internalResolved = {
  referenceId: REFERENCE_INTERNAL,
  sourceBlockId: 'nllc-art-1-par-4',
  sourceField: 'texto',
  span: span('§ 3º'),
  locator: {
    scope: 'same_law',
    context: 'same_article',
    selector: { kind: 'point', point: { paragrafo: '3' } },
  },
  evidence: [{ kind: 'grammar_match' }, { kind: 'structural_context' }],
  state: 'resolved',
  severity: 'info',
  target: {
    law: NLLC,
    revisionHash: HASH_NLLC,
    blockId: 'nllc-art-1-par-3',
  },
} as const;

const externalUnresolved = {
  referenceId: REFERENCE_EXTERNAL,
  sourceBlockId: 'nllc-art-1-par-5',
  sourceField: 'texto',
  span: span('caput do art. 37', 10),
  locator: {
    scope: 'external_law',
    lawMention: 'Constituição Federal',
    selector: { kind: 'point', point: { artigo: '37', caput: true } },
  },
  evidence: [{ kind: 'grammar_match' }],
  state: 'unresolved',
  severity: 'warning',
  reason: 'law_not_imported',
} as const;

const validIndex = (): unknown => ({
  schemaVersion: 1,
  law: NLLC,
  revisionHash: HASH_NLLC,
  analyzerVersion: '1.0.0',
  references: [internalResolved, externalUnresolved],
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('contratos de referências jurídicas', () => {
  it('infere o tipo público do schema e aceita estados resolvido e não resolvido', () => {
    const parsed = legalReferenceIndexSchema.parse(validIndex());

    expectTypeOf(parsed).toEqualTypeOf<LegalReferenceIndex>();
    expect(parsed.references).toHaveLength(2);
    expect(parsed.references[0]).toMatchObject({
      state: 'resolved',
      sourceBlockId: 'nllc-art-1-par-4',
      target: { blockId: 'nllc-art-1-par-3' },
    });
    expect(parsed.references[1]).toMatchObject({
      state: 'unresolved',
      reason: 'law_not_imported',
      severity: 'warning',
    });
  });

  it('modela lista, intervalo e ambiguidade sem aceitar candidatos repetidos', () => {
    const range = legalReferenceSchema.safeParse({
      ...externalUnresolved,
      referenceId: 'e'.repeat(64),
      locator: {
        scope: 'external_law',
        lawMention: 'Lei nº 9.099/1995',
        selector: {
          kind: 'range',
          from: { artigo: '61' },
          to: { artigo: '62' },
        },
      },
    });
    const list = legalReferenceSchema.safeParse({
      ...externalUnresolved,
      referenceId: 'f'.repeat(64),
      locator: {
        scope: 'external_law',
        lawMention: 'Constituição Federal',
        selector: {
          kind: 'list',
          points: [{ artigo: '37' }, { artigo: '39' }],
        },
      },
    });
    const duplicateCandidates = legalReferenceSchema.safeParse({
      ...externalUnresolved,
      state: 'ambiguous',
      severity: 'warning',
      reason: 'multiple_targets',
      candidates: [
        { law: CF1988, revisionHash: HASH_CF, blockId: 'cf1988-art-37' },
        { law: CF1988, revisionHash: HASH_CF, blockId: 'cf1988-art-37' },
      ],
    });

    expect(range.success).toBe(true);
    expect(list.success).toBe(true);
    expect(duplicateCandidates.success).toBe(false);
  });

  it('recusa spans incoerentes e localizador vazio ou caput subordinado', () => {
    const badSpan = legalReferenceSchema.safeParse({
      ...internalResolved,
      span: { ...span('§ 3º'), end: 99 },
    });
    const emptyPoint = legalReferenceSchema.safeParse({
      ...internalResolved,
      locator: {
        scope: 'same_law',
        context: 'same_article',
        selector: { kind: 'point', point: {} },
      },
    });
    const caputWithParagraph = legalReferenceSchema.safeParse({
      ...internalResolved,
      locator: {
        scope: 'same_law',
        context: 'same_article',
        selector: { kind: 'point', point: { artigo: '1', caput: true, paragrafo: '3' } },
      },
    });

    expect(badSpan.success).toBe(false);
    expect(emptyPoint.success).toBe(false);
    expect(caputWithParagraph.success).toBe(false);
  });

  it('amarra severidade às razões e proíbe campos de outro estado', () => {
    const staleWarning = legalReferenceSchema.safeParse({
      ...externalUnresolved,
      reason: 'stale_target',
      severity: 'warning',
    });
    const unresolvedWithTarget = legalReferenceSchema.safeParse({
      ...externalUnresolved,
      target: {
        law: CF1988,
        revisionHash: HASH_CF,
        blockId: 'cf1988-art-37',
      },
    });
    const aliasWarning = legalReferenceSchema.safeParse({
      ...externalUnresolved,
      state: 'ambiguous',
      reason: 'alias_collision',
      severity: 'warning',
      candidates: [
        { law: CF1988, revisionHash: HASH_CF, blockId: 'cf1988-art-37' },
        {
          law: { tipoNorma: 'constituição', numero: '1967', ano: 1967 },
          revisionHash: '1'.repeat(64),
          blockId: 'constituicao-1967-art-37',
        },
      ],
    });

    expect(staleWarning.success).toBe(false);
    expect(unresolvedWithTarget.success).toBe(false);
    expect(aliasWarning.success).toBe(false);
  });

  it('recusa alvo em lei incompatível com o escopo do localizador', () => {
    const invalid = clone(validIndex()) as {
      references: Record<string, unknown>[];
    };
    const first = invalid.references[0];
    if (first === undefined) throw new Error('Fixture sem referência interna.');
    first['target'] = {
      law: CF1988,
      revisionHash: HASH_CF,
      blockId: 'cf1988-art-37',
    };

    expect(legalReferenceIndexSchema.safeParse(invalid).success).toBe(false);
  });

  it('recusa IDs duplicados, ordem não canônica e spans sobrepostos', () => {
    const duplicated = clone(validIndex()) as { references: unknown[] };
    duplicated.references = [
      internalResolved,
      { ...externalUnresolved, referenceId: REFERENCE_INTERNAL },
    ];

    const unordered = clone(validIndex()) as { references: unknown[] };
    unordered.references.reverse();

    const overlapping = clone(validIndex()) as { references: unknown[] };
    overlapping.references = [
      internalResolved,
      {
        ...internalResolved,
        referenceId: '2'.repeat(64),
        span: span('3º', 2),
      },
    ];

    expect(legalReferenceIndexSchema.safeParse(duplicated).success).toBe(false);
    expect(legalReferenceIndexSchema.safeParse(unordered).success).toBe(false);
    expect(legalReferenceIndexSchema.safeParse(overlapping).success).toBe(false);
  });
});
