import type { IdentifiedNormaAST, SourceReference } from '../ast/nodes.js';
import { identifiedNormaAstSchema, parsedNormaAstSchema } from '../ast/schemas.js';
import { identificar } from '../block-id/index.js';
import { createLegislativeStructuralDiff, type LegislativeStructuralDiff } from '../diff/index.js';
import { legalNormIdentityKey } from '../legal-reference/catalog.js';
import { reconciliar, registrarPublicacao } from '../reconciliation/index.js';
import { normalizeNormativeText } from '../normative-projection/index.js';
import type { RevisionHashFunction } from './index.js';

type Node = Record<string, unknown> & { children: Node[] };
const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
const scalar = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const rootKey = 'root';
const nodeKey = (node: Node, parentKey: string): string =>
  node['tipo'] === 'lei'
    ? rootKey
    : typeof node['blockId'] === 'string'
      ? node['blockId']
      : `${parentKey}/${String(node['tipo'])}:${scalar(node['numero'])}`;
const asNode = (ast: IdentifiedNormaAST): Node => ast as unknown as Node;
const index = (root: Node): Map<string, Node> => {
  const nodes = new Map<string, Node>();
  const visit = (node: Node, path: string) => {
    const key = nodeKey(node, path);
    if (nodes.has(key)) throw new Error('SOURCE_AMBIGUOUS_STRUCTURE');
    nodes.set(key, node);
    for (const child of node.children) visit(child, key);
  };
  visit(root, '');
  return nodes;
};
const text = (node: Node): string => {
  if (node['tipo'] === 'tabela') {
    const headers = node['headers'] as string[];
    const rows = node['rows'] as string[][];
    return `Tabela ${scalar(node['numero'])}. ${scalar(node['caption'])} | ${headers.join('; ')} | ${rows.map((row) => row.join('; ')).join(' / ')}`;
  }
  return scalar(node['caput'] ?? node['texto'] ?? node['caption'] ?? node['titulo']);
};
const deviceTypes = new Set([
  'artigo',
  'paragrafo',
  'inciso',
  'alinea',
  'item',
  'pena',
  'anexo',
  'tabela',
]);
const editableFields = [
  'caput',
  'texto',
  'caption',
  'headers',
  'rows',
  'titulo',
  'deviceStatus',
  'notaStatus',
  'preservarTextoRevogado',
  'redacaoAtualDadaPor',
  'renumeradoPara',
] as const;
const normalizedValue = (value: unknown): unknown =>
  typeof value === 'string'
    ? normalizeNormativeText(value)
    : Array.isArray(value)
      ? value.map(normalizedValue)
      : value;
const sameOwnValue = (a: Node, b: Node) =>
  editableFields.every(
    (field) =>
      JSON.stringify(normalizedValue(a[field])) === JSON.stringify(normalizedValue(b[field])),
  );
const copyOwn = (from: Node, to: Node) => {
  for (const field of editableFields) {
    if (from[field] === undefined) Reflect.deleteProperty(to, field);
    else to[field] = clone(from[field]);
  }
};
const identifyFor = (ast: IdentifiedNormaAST, current: IdentifiedNormaAST): IdentifiedNormaAST => {
  const parsed = clone(ast);
  const visit = (node: Node) => {
    delete node['blockId'];
    for (const child of node.children) visit(child);
  };
  visit(asNode(parsed));
  const result = identificar(
    parsedNormaAstSchema.parse({ ...parsed, astPhase: 'parsed', sigla: current.sigla }),
    current.sigla,
    { permitirBaixaConfianca: true },
  );
  if (!result.ok) throw new Error('SOURCE_IDENTIFICATION_FAILED');
  const reconciled = reconciliar(
    result.valor,
    registrarPublicacao(current, current.sigla),
    current.sigla,
  );
  if (!reconciled.ok) throw new Error('SOURCE_RECONCILIATION_FAILED');
  return reconciled.valor.arvore;
};

/** Three-way composition: official source changes never silently erase local corrections. */
export const prepareLocalSourceUpdate = (
  current: IdentifiedNormaAST,
  sourceBase: IdentifiedNormaAST,
  incoming: IdentifiedNormaAST,
  checkedOn: string,
  sha256: RevisionHashFunction,
): Readonly<{
  ast: IdentifiedNormaAST;
  diff: LegislativeStructuralDiff;
  conflictingBlockIds: readonly string[];
  hasChanges: boolean;
}> => {
  if (
    legalNormIdentityKey(incoming) !== legalNormIdentityKey(sourceBase) ||
    legalNormIdentityKey(current) !== legalNormIdentityKey(sourceBase)
  )
    throw new Error('SOURCE_IDENTITY_MISMATCH');
  const base = identifyFor(sourceBase, current);
  const fresh = identifyFor(incoming, current);
  const officialDiff = createLegislativeStructuralDiff({ previous: base, current: fresh });
  if (!officialDiff.ok) throw new Error('SOURCE_DIFF_INVALID');
  const currentNodes = index(asNode(current));
  const baseNodes = index(asNode(base));
  const candidateNodes = index(asNode(fresh));
  const conflictingBlockIds: string[] = [];
  for (const [key, node] of candidateNodes) {
    if (node['tipo'] === 'lei') continue;
    const local = currentNodes.get(key);
    const original = baseNodes.get(key);
    if (local === undefined) continue;
    const changedOfficially = original === undefined || !sameOwnValue(original, node);
    const changedLocally = original !== undefined && !sameOwnValue(original, local);
    if (changedLocally && changedOfficially && !sameOwnValue(local, node))
      conflictingBlockIds.push(key);
    if (!changedOfficially) {
      copyOwn(local, node);
      node['parseEvidence'] = clone(local['parseEvidence']);
    }
    if (
      deviceTypes.has(String(node['tipo'])) &&
      ('redacoesAnteriores' in local || 'redacoesAnteriores' in node || text(local) !== text(node))
    ) {
      const histories = [
        ...((local['redacoesAnteriores'] as { texto: string; nota?: string }[] | undefined) ?? []),
        ...((node['redacoesAnteriores'] as { texto: string; nota?: string }[] | undefined) ?? []),
      ];
      if (text(local) !== text(node) && text(local).trim())
        histories.push({
          texto: text(local),
          nota: `Redação local anterior à conferência de ${checkedOn}.`,
        });
      node['redacoesAnteriores'] = histories.filter(
        (history, i) => histories.findIndex((item) => item.texto === history.texto) === i,
      );
    }
    if (
      deviceTypes.has(String(node['tipo'])) &&
      node['deviceStatus'] === 'revoked' &&
      local['deviceStatus'] !== 'revoked'
    ) {
      const field =
        node['tipo'] === 'artigo'
          ? 'caput'
          : node['tipo'] === 'anexo'
            ? 'titulo'
            : node['tipo'] === 'tabela'
              ? 'caption'
              : 'texto';
      if (typeof local[field] === 'string') node[field] = local[field];
      if (node['tipo'] === 'tabela') {
        node['headers'] = clone(local['headers']);
        node['rows'] = clone(local['rows']);
      }
      node['preservarTextoRevogado'] = true;
    }
  }
  // Restore absent subtrees at their original parent. No absent device is inferred revoked.
  const restore = (old: Node, parentKey: string, siblings: readonly Node[]): void => {
    const key = nodeKey(old, parentKey);
    if (!candidateNodes.has(key)) {
      const parent = candidateNodes.get(parentKey);
      if (parent === undefined) throw new Error('SOURCE_MISSING_PARENT');
      const preserved = clone(old);
      preserved.children = [];
      preserved['id'] = `preserved-${sha256(key).slice(0, 24)}`;
      preserved['parseEvidence'] = {
        confidence: 'low',
        reasons: ['source_text_conflict'],
        requiresHumanReview: true,
        editorialNote: 'Ausente na nova fonte; preservado sem presumir revogação.',
      };
      // Keep a missing device before the next retained sibling, without changing
      // the order supplied by the new official source.
      const oldPosition = siblings.indexOf(old);
      const next = siblings
        .slice(oldPosition + 1)
        .map((sibling) => candidateNodes.get(nodeKey(sibling, parentKey)))
        .find((sibling) => sibling !== undefined && parent.children.includes(sibling));
      const position = next === undefined ? parent.children.length : parent.children.indexOf(next);
      parent.children.splice(position, 0, preserved);
      candidateNodes.set(key, preserved);
    }
    for (const child of old.children) restore(child, key, old.children);
  };
  for (const child of asNode(current).children) restore(child, rootKey, asNode(current).children);
  const refs = new Map<string, SourceReference>(
    [fresh.sourceRef, ...(fresh.supportingSourceRefs ?? [])].map((ref) => [
      ref.sourceArtifactSha256,
      ref,
    ]),
  );
  const remap = (node: Node) => {
    const mapRef = (raw: unknown): unknown => {
      const ref = raw as SourceReference;
      const existing = [fresh.sourceRef, ...(fresh.supportingSourceRefs ?? [])].find(
        (item) =>
          item.sourceArtifactSha256 === ref.sourceArtifactSha256 &&
          item.sourceRole === ref.sourceRole &&
          item.sourceVariant === ref.sourceVariant,
      );
      const canonical = existing ?? refs.get(ref.sourceArtifactSha256);
      return canonical === undefined
        ? ref
        : {
            ...ref,
            sourceRole: canonical.sourceRole,
            sourceVariant: canonical.sourceVariant,
            ...(canonical.sourceUrl === undefined ? {} : { sourceUrl: canonical.sourceUrl }),
          };
    };
    node['sourceRef'] = mapRef(node['sourceRef']);
    if (Array.isArray(node['supportingSourceRefs']))
      node['supportingSourceRefs'] = node['supportingSourceRefs'].map(mapRef);
    node.children.forEach((child, i) => {
      child['ordem'] = i;
      remap(child);
    });
  };
  remap(asNode(fresh));
  // Preserve all editorial metadata; only provenance, shape and verification date come from the check.
  const merged = {
    ...clone(current),
    children: fresh.children,
    sourceRef: fresh.sourceRef,
    supportingSourceRefs: fresh.supportingSourceRefs ?? [],
    idsDepreciados: fresh.idsDepreciados ?? current.idsDepreciados ?? [],
    dataVerificacaoIntegridade: checkedOn,
  };
  let articles = 0;
  const count = (node: Node) => {
    if (node['tipo'] === 'artigo') articles++;
    node.children.forEach(count);
  };
  count(asNode(merged));
  merged.totalArtigos = articles;
  const ast = identifiedNormaAstSchema.parse(merged);
  const review = createLegislativeStructuralDiff({ previous: current, current: ast });
  if (!review.ok) throw new Error('SOURCE_DIFF_INVALID');
  // Official absence remains visible even though the composed revision retains it.
  const diff = {
    ...review.valor,
    missingPublished: officialDiff.valor.missingPublished,
    summary: {
      ...review.valor.summary,
      missingPublished: officialDiff.valor.summary.missingPublished,
    },
  };
  return {
    ast,
    diff,
    conflictingBlockIds,
    hasChanges:
      officialDiff.valor.summary.amended +
        officialDiff.valor.summary.included +
        officialDiff.valor.summary.revoked +
        officialDiff.valor.summary.renumbered +
        officialDiff.valor.summary.missingPublished >
      0,
  };
};
