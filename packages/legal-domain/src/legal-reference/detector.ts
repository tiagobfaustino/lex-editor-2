import type { z } from 'zod';

import { falha, problemasDoZod, type ResultadoValidacao, sucesso } from '../ast/errors.js';
import { percorrer, validarIdentifiedNormaAst } from '../ast/validate.js';
import {
  calculateRevisionHash,
  revisionHashSchema,
  type RevisionHashFunction,
} from '../editorial-commands/index.js';
import {
  legalReferenceIndexSchema,
  legalReferenceLocatorSchema,
  legalReferenceSpanSchema,
  type LegalNormIdentity,
  type LegalReference,
  type LegalReferenceIndex,
  type LegalReferenceLocator,
  type LegalReferencePoint,
  type LegalReferenceSelector,
  type LegalReferenceSourceField,
  type LegalReferenceSpan,
} from './contracts.js';

const DETECTOR_VERSION = '1.0.0';
const ORDINAL = '[º°o]?';
const ARTICLE = `\\d+(?:\\s*-\\s*[A-Za-z]+)?${ORDINAL}`;
const PARAGRAPH = `(?:\\d+(?:\\s*-\\s*[A-Za-z]+)?${ORDINAL}|[úu]nico)`;
const ROMAN = '[IVXLCDM]+(?:\\s*-\\s*[A-Za-z]+)?';
const LETTER = '[a-z]{1,2}';
const ITEM = '\\d{1,2}';

const series = (value: string): string => `${value}(?:\\s*(?:,|e|a)\\s*${value})*`;

const EXTERNAL_LAW = [
  'Constitui[çc][ãa]o\\s+Federal(?:\\s+de\\s+1988)?',
  'Constitui[çc][ãa]o\\s+da\\s+Rep[úu]blica\\s+Federativa\\s+do\\s+Brasil',
  '(?:Lei|Decreto-Lei)(?:\\s+Complementar)?\\s+n?[º°o.]?\\s*\\d[\\d.]*' +
    '(?:\\s*\\/\\s*\\d{2,4}|\\s*,\\s*de\\s+\\d{1,2}\\s+de\\s+[A-Za-zÀ-ÖØ-öø-ÿçÇ]+\\s+de\\s+\\d{4}|\\s*,\\s*de\\s+\\d{4})?',
].join('|');

const SCOPE = [
  'deste\\s+artigo',
  'desse\\s+artigo',
  'neste\\s+artigo',
  'do\\s+mesmo\\s+artigo',
  'desta\\s+(?:mesma\\s+)?[Ll]ei',
  'nessa\\s+[Ll]ei',
  `(?:da|do)\\s+(?:${EXTERNAL_LAW})`,
].join('|');

type PatternKind = 'article' | 'paragraph' | 'inciso' | 'alinea' | 'item' | 'caput';

interface DetectionPattern {
  readonly kind: PatternKind;
  readonly expression: RegExp;
}

const expression = (mention: string): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?<mention>${mention})\\s+(?<scope>${SCOPE})(?=$|[\\s,;:.])`,
    'giu',
  );

const PATTERNS: readonly DetectionPattern[] = [
  {
    kind: 'item',
    expression: expression(
      `itens?\\s+(?<values>${series(ITEM)})` +
        `(?:\\s+da\\s+al[íi]nea\\s+(?<alinea>${LETTER}))?` +
        `(?:\\s+do\\s+inciso\\s+(?<inciso>${ROMAN}))?` +
        `(?:\\s+do\\s+(?:§|par[áa]grafo)\\s*(?<paragraph>${PARAGRAPH}))?` +
        `(?:\\s+do\\s+(?:art\\.?|artigo)\\s*(?<article>${ARTICLE}))?`,
    ),
  },
  {
    kind: 'alinea',
    expression: expression(
      `al[íi]neas?\\s+(?<values>${series(LETTER)})` +
        `(?:\\s+do\\s+inciso\\s+(?<inciso>${ROMAN}))?` +
        `(?:\\s+do\\s+(?:§|par[áa]grafo)\\s*(?<paragraph>${PARAGRAPH}))?` +
        `(?:\\s+do\\s+(?:art\\.?|artigo)\\s*(?<article>${ARTICLE}))?`,
    ),
  },
  {
    kind: 'inciso',
    expression: expression(
      `incisos?\\s+(?<values>${series(ROMAN)})` +
        `(?:\\s+do\\s+(?<caput>caput))?` +
        `(?:\\s+do\\s+(?:§|par[áa]grafo)\\s*(?<paragraph>${PARAGRAPH}))?` +
        `(?:\\s+do\\s+(?:art\\.?|artigo)\\s*(?<article>${ARTICLE}))?`,
    ),
  },
  {
    kind: 'paragraph',
    expression: expression(
      `(?:§§?|par[áa]grafos?)\\s*(?<values>${series(PARAGRAPH)})` +
        `(?:\\s+do\\s+(?:art\\.?|artigo)\\s*(?<article>${ARTICLE}))?`,
    ),
  },
  {
    kind: 'article',
    expression: expression(
      `(?:(?<caput>caput)\\s+(?:do|dos)\\s+)?` +
        `(?:arts?\\.?|artigos?)\\s*(?<values>${series(ARTICLE)})`,
    ),
  },
  {
    kind: 'caput',
    expression: expression('caput'),
  },
] as const;

export interface DetectedLegalReferenceMention {
  readonly span: LegalReferenceSpan;
  readonly locator: LegalReferenceLocator;
}

export interface DetectLegalReferencesOptions {
  readonly sha256: RevisionHashFunction;
  readonly analyzerVersion?: string;
}

const group = (match: RegExpExecArray, name: string): string | undefined => match.groups?.[name];

const normalizeNumericDesignator = (value: string): string => {
  const normalized = value
    .normalize('NFC')
    .trim()
    .replace(/[º°o]$/iu, '')
    .replace(/\s*-\s*/gu, '-');
  return normalized.toLocaleLowerCase('pt-BR') === 'único' || normalized === 'unico'
    ? 'unico'
    : normalized.replace(/-([A-Za-z]+)$/u, (_whole, suffix: string) => `-${suffix.toUpperCase()}`);
};

const normalizeRoman = (value: string): string =>
  value
    .trim()
    .replace(/\s*-\s*/gu, '-')
    .toUpperCase();

const normalizeLetter = (value: string): string => value.trim().toLocaleLowerCase('pt-BR');

const splitSeries = (
  raw: string,
): { readonly kind: 'list' | 'range'; readonly values: string[] } => {
  if (/\s+a\s/iu.test(raw)) {
    if (/,|\s+e\s+/iu.test(raw)) {
      throw new Error('Lista combinada com intervalo ainda não é suportada.');
    }
    return { kind: 'range', values: raw.split(/\s+a\s/iu) };
  }
  return { kind: 'list', values: raw.split(/\s*(?:,|e)\s*/iu) };
};

const pointFrom = (
  kind: PatternKind,
  value: string | undefined,
  match: RegExpExecArray,
): LegalReferencePoint => {
  const point: Record<string, string | true> = {};
  const article = group(match, 'article');
  const paragraph = group(match, 'paragraph');
  const inciso = group(match, 'inciso');
  const alinea = group(match, 'alinea');

  if (article !== undefined) point['artigo'] = normalizeNumericDesignator(article);
  if (paragraph !== undefined) point['paragrafo'] = normalizeNumericDesignator(paragraph);
  if (inciso !== undefined) point['inciso'] = normalizeRoman(inciso);
  if (alinea !== undefined) point['alinea'] = normalizeLetter(alinea);
  if (group(match, 'caput') !== undefined) point['caput'] = true;

  if (kind === 'article' && value !== undefined) {
    point['artigo'] = normalizeNumericDesignator(value);
  } else if (kind === 'paragraph' && value !== undefined) {
    point['paragrafo'] = normalizeNumericDesignator(value);
  } else if (kind === 'inciso' && value !== undefined) {
    point['inciso'] = normalizeRoman(value);
  } else if (kind === 'alinea' && value !== undefined) {
    point['alinea'] = normalizeLetter(value);
  } else if (kind === 'item' && value !== undefined) {
    point['item'] = normalizeNumericDesignator(value);
  } else if (kind === 'caput') {
    point['caput'] = true;
  }

  return point;
};

const selectorFrom = (kind: PatternKind, match: RegExpExecArray): LegalReferenceSelector => {
  if (kind === 'caput') return { kind: 'point', point: pointFrom(kind, undefined, match) };

  const rawValues = group(match, 'values');
  if (rawValues === undefined) {
    throw new Error('A regra de referência não capturou seus designadores.');
  }
  const seriesResult = splitSeries(rawValues);
  const points = seriesResult.values.map((value) => pointFrom(kind, value, match));
  if (seriesResult.kind === 'range') {
    const [from, to] = points;
    if (from === undefined || to === undefined || points.length !== 2) {
      throw new Error('Um intervalo jurídico precisa ter exatamente dois extremos.');
    }
    return { kind: 'range', from, to };
  }
  if (points.length === 1 && points[0] !== undefined) {
    return { kind: 'point', point: points[0] };
  }
  return { kind: 'list', points };
};

const locatorFrom = (scope: string, selector: LegalReferenceSelector): LegalReferenceLocator => {
  if (/^(?:deste|desse|neste)\s+artigo$|^do\s+mesmo\s+artigo$/iu.test(scope)) {
    return { scope: 'same_law', context: 'same_article', selector };
  }
  if (/^(?:desta(?:\s+mesma)?|nessa)\s+lei$/iu.test(scope)) {
    return { scope: 'same_law', context: 'same_law', selector };
  }
  return {
    scope: 'external_law',
    lawMention: scope.replace(/^(?:da|do)\s+/iu, ''),
    selector,
  };
};

const compareMentions = (
  left: DetectedLegalReferenceMention,
  right: DetectedLegalReferenceMention,
): number => left.span.start - right.span.start || right.span.end - left.span.end;

/**
 * Detecta apenas referências com contexto explícito. A saída é uma projeção
 * de spans; o texto recebido nunca é normalizado, reescrito ou mutado.
 */
export const detectLegalReferenceMentions = (
  text: string,
): readonly DetectedLegalReferenceMention[] => {
  const candidates: DetectedLegalReferenceMention[] = [];

  for (const pattern of PATTERNS) {
    pattern.expression.lastIndex = 0;
    for (
      let match = pattern.expression.exec(text);
      match !== null;
      match = pattern.expression.exec(text)
    ) {
      const mention = group(match, 'mention');
      const scope = group(match, 'scope');
      if (mention === undefined || scope === undefined) continue;

      const relativeStart = match[0].indexOf(mention);
      const start = match.index + relativeStart;
      const spanResult = legalReferenceSpanSchema.safeParse({
        encoding: 'utf16',
        start,
        end: start + mention.length,
        text: mention,
      });
      if (!spanResult.success) continue;

      try {
        const locator = legalReferenceLocatorSchema.parse(
          locatorFrom(scope, selectorFrom(pattern.kind, match)),
        );
        candidates.push({ span: spanResult.data, locator });
      } catch {
        // A regra que não consegue produzir um localizador válido falha
        // fechada: não emite menção parcial nem tenta adivinhar o alvo.
      }
    }
  }

  candidates.sort(compareMentions);
  const accepted: DetectedLegalReferenceMention[] = [];
  for (const candidate of candidates) {
    const previous = accepted.at(-1);
    if (previous !== undefined && candidate.span.start < previous.span.end) continue;
    accepted.push(candidate);
  }
  return Object.freeze(accepted.map((candidate) => Object.freeze(candidate)));
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareReferences = (left: LegalReference, right: LegalReference): number =>
  compareText(left.sourceBlockId, right.sourceBlockId) ||
  compareText(left.sourceField, right.sourceField) ||
  left.span.start - right.span.start ||
  left.span.end - right.span.end ||
  compareText(left.referenceId, right.referenceId);

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const referenceIdFor = (
  revisionHash: string,
  analyzerVersion: string,
  sourceBlockId: string,
  sourceField: LegalReferenceSourceField,
  mention: DetectedLegalReferenceMention,
  sha256: RevisionHashFunction,
): string =>
  revisionHashSchema.parse(
    sha256(
      JSON.stringify({
        revisionHash,
        analyzerVersion,
        sourceBlockId,
        sourceField,
        span: mention.span,
        locator: mention.locator,
      }),
    ),
  );

const lawIdentityFrom = (ast: {
  tipoNorma: LegalNormIdentity['tipoNorma'];
  numero: string;
  ano: number;
}): LegalNormIdentity => ({
  tipoNorma: ast.tipoNorma,
  numero: ast.numero,
  ano: ast.ano,
});

/** Produz o índice detectado e ligado ao hash da IdentifiedNormaAST. */
export const detectLegalReferences = (
  input: unknown,
  options: DetectLegalReferencesOptions,
): ResultadoValidacao<Readonly<LegalReferenceIndex>> => {
  const validation = validarIdentifiedNormaAst(input);
  if (!validation.ok) return validation;

  const analyzerVersion = options.analyzerVersion ?? DETECTOR_VERSION;
  let revisionHash: string;
  try {
    revisionHash = calculateRevisionHash(validation.valor, options.sha256);
  } catch {
    return falha([
      {
        codigo: 'schema_invalido',
        caminho: ['revisionHash'],
        mensagem: 'A função SHA-256 não produziu um hash de revisão válido.',
      },
    ]);
  }

  const references: LegalReference[] = [];
  try {
    percorrer(
      validation.valor,
      ({ no }) => {
        const blockId = no['blockId'];
        if (typeof blockId !== 'string') return;

        const fields: readonly LegalReferenceSourceField[] =
          no['tipo'] === 'artigo' ? ['caput'] : typeof no['texto'] === 'string' ? ['texto'] : [];
        for (const sourceField of fields) {
          const text = no[sourceField];
          if (typeof text !== 'string') continue;
          for (const mention of detectLegalReferenceMentions(text)) {
            references.push({
              referenceId: referenceIdFor(
                revisionHash,
                analyzerVersion,
                blockId,
                sourceField,
                mention,
                options.sha256,
              ),
              sourceBlockId: blockId,
              sourceField,
              span: mention.span,
              locator: mention.locator,
              evidence:
                mention.locator.scope === 'same_law'
                  ? [{ kind: 'grammar_match' }, { kind: 'structural_context' }]
                  : [{ kind: 'grammar_match' }],
              state: 'detected',
              severity: 'info',
            });
          }
        }
      },
      () => undefined,
    );

    references.sort(compareReferences);
    const index = legalReferenceIndexSchema.parse({
      schemaVersion: 1,
      law: lawIdentityFrom(validation.valor),
      revisionHash,
      analyzerVersion,
      references,
    });
    return sucesso(deepFreeze(index));
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'issues' in error) {
      return falha(problemasDoZod(error as z.ZodError));
    }
    return falha([
      {
        codigo: 'schema_invalido',
        caminho: ['references'],
        mensagem: 'A detecção não conseguiu produzir um índice de referências válido.',
      },
    ]);
  }
};
