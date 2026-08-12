import {
  criarProblema,
  falha,
  problemasDoZod,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { calculateRevisionHash, type RevisionHashFunction } from '../editorial-commands/index.js';
import { legalNormIdentityKey } from '../legal-reference/catalog.js';
import { legalReferenceIndexSchema, type LegalReference } from '../legal-reference/contracts.js';
import { vincuLexLayoutSchema, type VincuLexLayout } from '../legal-reference/layout.js';

export interface FormatLegalReferencesOptions {
  readonly referenceIndex: unknown;
  readonly layout: unknown;
  readonly sha256: RevisionHashFunction;
}

export interface LegalReferenceFormattingContext {
  readonly aliases: readonly string[];
  materialize(node: Record<string, unknown>, field: 'caput' | 'texto', value: string): string;
}

const identityFromAst = (ast: IdentifiedNormaAST) => ({
  tipoNorma: ast.tipoNorma,
  numero: ast.numero,
  ano: ast.ano,
});

const nodesByBlockId = (ast: IdentifiedNormaAST): Map<string, Record<string, unknown>> => {
  const nodes = new Map<string, Record<string, unknown>>();
  const visit = (node: Record<string, unknown>): void => {
    if (typeof node['blockId'] === 'string') nodes.set(node['blockId'], node);
    const children = Array.isArray(node['children'])
      ? (node['children'] as Record<string, unknown>[])
      : [];
    for (const child of children) visit(child);
  };
  visit(ast as unknown as Record<string, unknown>);
  return nodes;
};

const sameLaw = (
  left: { tipoNorma: string; numero: string; ano: number },
  right: { tipoNorma: string; numero: string; ano: number },
): boolean =>
  left.tipoNorma === right.tipoNorma && left.numero === right.numero && left.ano === right.ano;

const invalid = (path: readonly (string | number)[], message: string) =>
  falha([criarProblema('referencia_juridica_invalida', path, message)]);

const linkFor = (
  reference: Extract<LegalReference, { state: 'resolved' }>,
  sourceLaw: { tipoNorma: string; numero: string; ano: number },
  layout: VincuLexLayout,
): ResultadoValidacao<string> => {
  const targetKey = legalNormIdentityKey(reference.target.law);
  const target = layout.entries.find(
    (entry) =>
      entry.canonicalKey === targetKey && entry.revisionHash === reference.target.revisionHash,
  );
  if (target?.blockIds.includes(reference.target.blockId) !== true) {
    return invalid(
      ['referenceIndex', 'references', reference.referenceId, 'target'],
      'A referência resolvida aponta para lei, revisão ou Block ID ausente do layout exportável.',
    );
  }
  if (/[[\]|\r\n]/u.test(reference.span.text)) {
    return invalid(
      ['referenceIndex', 'references', reference.referenceId, 'span', 'text'],
      'O label literal contém caractere incompatível com um wikilink seguro.',
    );
  }

  const targetPrefix = sameLaw(sourceLaw, reference.target.law) ? '' : target.wikiPath;
  return sucesso(`[[${targetPrefix}#^${reference.target.blockId}|${reference.span.text}]]`);
};

/**
 * Confere índice, revisão, spans e alvos antes de permitir qualquer decoração.
 * A árvore normativa nunca é alterada: a função devolvida opera em strings.
 */
export const prepareLegalReferenceFormatting = (
  originalAst: IdentifiedNormaAST,
  projectedAst: IdentifiedNormaAST,
  options: FormatLegalReferencesOptions,
): ResultadoValidacao<LegalReferenceFormattingContext> => {
  const indexResult = legalReferenceIndexSchema.safeParse(options.referenceIndex);
  if (!indexResult.success) {
    return falha(
      problemasDoZod(indexResult.error).map((problem) => ({
        ...problem,
        codigo: 'referencia_juridica_invalida' as const,
      })),
    );
  }
  const layoutResult = vincuLexLayoutSchema.safeParse(options.layout);
  if (!layoutResult.success) {
    return falha(
      problemasDoZod(layoutResult.error).map((problem) => ({
        ...problem,
        codigo: 'referencia_juridica_invalida' as const,
      })),
    );
  }
  const index = indexResult.data;
  const layout = layoutResult.data;
  const sourceLaw = identityFromAst(originalAst);
  if (!sameLaw(index.law, sourceLaw)) {
    return invalid(['referenceIndex', 'law'], 'O índice pertence a outra norma.');
  }
  let revisionHash: string;
  try {
    revisionHash = calculateRevisionHash(originalAst, options.sha256);
  } catch {
    return invalid(
      ['referenceIndex', 'revisionHash'],
      'Não foi possível calcular o hash da revisão.',
    );
  }
  if (index.revisionHash !== revisionHash) {
    return invalid(
      ['referenceIndex', 'revisionHash'],
      'O índice de referências está obsoleto para a revisão formatada.',
    );
  }

  const sourceEntry = layout.entries.find(
    (entry) =>
      entry.canonicalKey === legalNormIdentityKey(sourceLaw) && entry.revisionHash === revisionHash,
  );
  if (sourceEntry === undefined) {
    return invalid(['layout', 'entries'], 'A revisão de origem não existe no layout exportável.');
  }

  const originalNodes = nodesByBlockId(originalAst);
  const projectedNodes = nodesByBlockId(projectedAst);
  const materialized = new Map<string, readonly { start: number; end: number; link: string }[]>();

  for (const reference of index.references) {
    const originalNode = originalNodes.get(reference.sourceBlockId);
    const originalText = originalNode?.[reference.sourceField];
    if (
      typeof originalText !== 'string' ||
      originalText.slice(reference.span.start, reference.span.end) !== reference.span.text
    ) {
      return invalid(
        ['referenceIndex', 'references', reference.referenceId, 'span'],
        'O span não corresponde ao texto canônico da revisão de origem.',
      );
    }

    // O perfil vigente pode remover integralmente a origem. Nesse caso a
    // aresta continua no índice da revisão, mas não aparece neste artefato.
    if (!projectedNodes.has(reference.sourceBlockId) || reference.state !== 'resolved') continue;

    const link = linkFor(reference, sourceLaw, layout);
    if (!link.ok) return link;
    const key = `${reference.sourceBlockId}\u0000${reference.sourceField}`;
    const spans = materialized.get(key) ?? [];
    materialized.set(key, [
      ...spans,
      { start: reference.span.start, end: reference.span.end, link: link.valor },
    ]);
  }

  return sucesso({
    aliases: sourceEntry.aliases,
    materialize(node, field, value) {
      const blockId = typeof node['blockId'] === 'string' ? node['blockId'] : '';
      const spans = materialized.get(`${blockId}\u0000${field}`) ?? [];
      let result = value;
      for (const span of [...spans].sort((left, right) => right.start - left.start)) {
        result = `${result.slice(0, span.start)}${span.link}${result.slice(span.end)}`;
      }
      return result;
    },
  });
};
