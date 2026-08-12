// Diff estrutural de atualização legislativa (Feature 008, T008-02).
//
// A unidade de comparação é um dispositivo identificado, nunca uma linha de
// HTML/Markdown. Identidade vem do Block ID reconciliado; texto, hierarquia e
// estados vêm da projeção jurídica do nó. Proveniência, evidência técnica e
// histórico de apresentação não transformam uma mudança cosmética em alteração
// legislativa.

import { z } from 'zod';

import {
  deviceStatusSchema,
  parseConfidenceReasonSchema,
  parseConfidenceSchema,
  tipoNoSchema,
  type DeviceStatus,
  type ParseConfidence,
  type ParseConfidenceReason,
} from '../ast/enums.js';
import {
  criarProblema,
  falha,
  problemasDoZod,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { IdentifiedChildNode, IdentifiedNormaAST } from '../ast/nodes.js';
import { validarIdentifiedNormaAst } from '../ast/validate.js';
import { normalizeNormativeText } from '../normative-projection/index.js';

const blockIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const childTypeSchema = tipoNoSchema.exclude(['lei']);

export const legislativeDiffCategorySchema = z.enum([
  'unchanged',
  'amended',
  'included',
  'revoked',
  'renumbered',
]);

export const legislativePathSegmentSchema = z.strictObject({
  tipo: childTypeSchema,
  ordem: z.int().nonnegative(),
  label: z.string().min(1),
});

export const legislativeDiffSideSchema = z.strictObject({
  blockId: blockIdSchema,
  path: z.array(legislativePathSegmentSchema).min(1).max(50),
  text: z.string(),
  deviceStatus: deviceStatusSchema,
});

export const legislativeDiffEntrySchema = z
  .strictObject({
    category: legislativeDiffCategorySchema,
    affectedBlockId: blockIdSchema.nullable(),
    resultingDeviceStatus: deviceStatusSchema,
    before: legislativeDiffSideSchema.nullable(),
    after: legislativeDiffSideSchema.nullable(),
    confidence: parseConfidenceSchema,
    confidenceReasons: z.array(parseConfidenceReasonSchema),
    requiresHumanReview: z.boolean(),
    renumberingEvidence: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((entry, context) => {
    if (entry.category === 'included' && (entry.before !== null || entry.after === null)) {
      context.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Inclusão exige somente o lado candidato.',
      });
    }
    if (entry.category !== 'included' && (entry.before === null || entry.after === null)) {
      context.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'A categoria exige os lados publicado e candidato.',
      });
    }
    if ((entry.category === 'renumbered') !== (entry.renumberingEvidence !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['renumberingEvidence'],
        message: 'Somente renumeração exige evidência oficial explícita.',
      });
    }
  });

export const explicitRenumberingSchema = z.strictObject({
  fromBlockId: blockIdSchema,
  toBlockId: blockIdSchema,
  evidence: z.string().trim().min(1).max(500),
});

const explicitRenumberingsSchema = z
  .array(explicitRenumberingSchema)
  .max(20_000)
  .superRefine((mappings, context) => {
    const fromSeen = new Set<string>();
    const toSeen = new Set<string>();
    mappings.forEach((mapping, index) => {
      if (mapping.fromBlockId === mapping.toBlockId) {
        context.addIssue({
          code: 'custom',
          path: [index, 'toBlockId'],
          message: 'Renumeração exige Block IDs distintos.',
        });
      }
      if (fromSeen.has(mapping.fromBlockId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'fromBlockId'],
          message: 'O Block ID de origem aparece em mais de uma renumeração.',
        });
      }
      if (toSeen.has(mapping.toBlockId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'toBlockId'],
          message: 'O Block ID de destino aparece em mais de uma renumeração.',
        });
      }
      fromSeen.add(mapping.fromBlockId);
      toSeen.add(mapping.toBlockId);
    });
  });

export const legislativeDiffSummarySchema = z.strictObject({
  unchanged: z.int().nonnegative(),
  amended: z.int().nonnegative(),
  included: z.int().nonnegative(),
  revoked: z.int().nonnegative(),
  renumbered: z.int().nonnegative(),
  missingPublished: z.int().nonnegative(),
});

export const legislativeStructuralDiffSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(legislativeDiffEntrySchema).max(100_000),
  missingPublished: z.array(legislativeDiffSideSchema).max(100_000),
  summary: legislativeDiffSummarySchema,
  requiresHumanReview: z.boolean(),
});

export type LegislativeDiffCategory = z.infer<typeof legislativeDiffCategorySchema>;
export type LegislativePathSegment = z.infer<typeof legislativePathSegmentSchema>;
export type LegislativeDiffSide = z.infer<typeof legislativeDiffSideSchema>;
export type LegislativeDiffEntry = z.infer<typeof legislativeDiffEntrySchema>;
export type ExplicitRenumbering = z.infer<typeof explicitRenumberingSchema>;
export type LegislativeDiffSummary = z.infer<typeof legislativeDiffSummarySchema>;
export type LegislativeStructuralDiff = z.infer<typeof legislativeStructuralDiffSchema>;

type IndexedNode = Readonly<{
  node: IdentifiedChildNode;
  side: LegislativeDiffSide;
  legalValue: string;
  confidence: ParseConfidence;
  confidenceReasons: readonly ParseConfidenceReason[];
  requiresHumanReview: boolean;
}>;

const labelOf = (node: IdentifiedChildNode): string => {
  if (node.tipo === 'artigo') return `Art. ${node.numero}`;
  if (node.tipo === 'paragrafo')
    return node.numero === 'unico' ? 'Parágrafo único' : `§ ${node.numero}º`;
  if (node.tipo === 'inciso') return `Inciso ${node.numero.toUpperCase()}`;
  if (node.tipo === 'alinea') return `Alínea ${node.letra}`;
  if (node.tipo === 'item') return `Item ${node.numero}`;
  if (node.tipo === 'pena') return node.numero === undefined ? 'Pena' : `Pena ${node.numero}`;
  if (node.tipo === 'anexo') return `Anexo ${node.numero}`;
  if (node.tipo === 'tabela') return `Tabela ${node.numero}`;
  if (node.tipo === 'ato_transitorio') return normalizeNormativeText(node.titulo);
  const number = node.numero === undefined ? '' : ` ${node.numero}`;
  return normalizeNormativeText(`${node.tipo}${number}: ${node.titulo}`);
};

const textOf = (node: IdentifiedChildNode): string => {
  if (node.tipo === 'artigo') return normalizeNormativeText(`Art. ${node.numero}. ${node.caput}`);
  if (node.tipo === 'paragrafo')
    return normalizeNormativeText(
      node.numero === 'unico'
        ? `Parágrafo único. ${node.texto}`
        : `§ ${node.numero}º ${node.texto}`,
    );
  if (node.tipo === 'inciso')
    return normalizeNormativeText(`${node.numero.toUpperCase()} - ${node.texto}`);
  if (node.tipo === 'alinea') return normalizeNormativeText(`${node.letra}) ${node.texto}`);
  if (node.tipo === 'item') return normalizeNormativeText(`${node.numero}. ${node.texto}`);
  if (node.tipo === 'pena') return normalizeNormativeText(node.texto);
  if (node.tipo === 'anexo') return normalizeNormativeText(`Anexo ${node.numero} - ${node.titulo}`);
  if (node.tipo === 'tabela') {
    return normalizeNormativeText(
      `Tabela ${node.numero}. ${node.caption} | ${node.headers.join('; ')} | ${node.rows
        .map((row) => row.join('; '))
        .join(' / ')}`,
    );
  }
  return normalizeNormativeText(labelOf(node));
};

const optionalNormativeText = (
  node: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, string>> => {
  const value = node[key];
  return typeof value === 'string' ? { [key]: normalizeNormativeText(value) } : {};
};

/** Valor jurídico próprio do nó; filhos e histórico são comparados separadamente. */
const ownLegalValue = (node: IdentifiedChildNode): string => {
  const record = node as unknown as Readonly<Record<string, unknown>>;
  const headers =
    node.tipo === 'tabela' ? node.headers.map((value) => normalizeNormativeText(value)) : undefined;
  const rows =
    node.tipo === 'tabela'
      ? node.rows.map((row) => row.map((value) => normalizeNormativeText(value)))
      : undefined;
  return JSON.stringify({
    tipo: node.tipo,
    ordem: node.ordem,
    deviceStatus: node.deviceStatus,
    ...optionalNormativeText(record, 'numero'),
    ...optionalNormativeText(record, 'letra'),
    ...optionalNormativeText(record, 'titulo'),
    ...optionalNormativeText(record, 'caput'),
    ...optionalNormativeText(record, 'texto'),
    ...optionalNormativeText(record, 'caption'),
    ...optionalNormativeText(record, 'notaStatus'),
    ...(headers === undefined ? {} : { headers }),
    ...(rows === undefined ? {} : { rows }),
  });
};

const indexNodes = (ast: IdentifiedNormaAST): Map<string, IndexedNode> => {
  const result = new Map<string, IndexedNode>();
  const visit = (
    node: IdentifiedChildNode,
    parentPath: readonly LegislativePathSegment[],
  ): void => {
    const segment: LegislativePathSegment = {
      tipo: node.tipo,
      ordem: node.ordem,
      label: labelOf(node),
    };
    const path = [...parentPath, segment];
    if ('blockId' in node && typeof node.blockId === 'string') {
      const side = legislativeDiffSideSchema.parse({
        blockId: node.blockId,
        path,
        text: textOf(node),
        deviceStatus: node.deviceStatus,
      });
      result.set(node.blockId, {
        node,
        side,
        legalValue: ownLegalValue(node),
        confidence: node.parseEvidence.confidence,
        confidenceReasons: node.parseEvidence.reasons,
        requiresHumanReview: node.parseEvidence.requiresHumanReview,
      });
    }
    for (const child of node.children) visit(child, path);
  };
  for (const child of ast.children) visit(child, []);
  return result;
};

const resultingStatus: Readonly<Record<LegislativeDiffCategory, DeviceStatus>> = Object.freeze({
  unchanged: 'active',
  amended: 'amended',
  included: 'included',
  revoked: 'revoked',
  renumbered: 'renumbered',
});

const entry = (options: {
  category: LegislativeDiffCategory;
  affectedBlockId: string | null;
  before: IndexedNode | null;
  after: IndexedNode | null;
  renumberingEvidence?: string | undefined;
}): LegislativeDiffEntry => {
  const evidence = options.after ?? options.before;
  if (evidence === null) throw new Error('Entrada de diff sem nenhum lado.');
  return legislativeDiffEntrySchema.parse({
    category: options.category,
    affectedBlockId: options.affectedBlockId,
    resultingDeviceStatus:
      options.category === 'unchanged'
        ? evidence.node.deviceStatus
        : resultingStatus[options.category],
    before: options.before?.side ?? null,
    after: options.after?.side ?? null,
    confidence: evidence.confidence,
    confidenceReasons: evidence.confidenceReasons,
    requiresHumanReview: evidence.requiresHumanReview,
    renumberingEvidence: options.renumberingEvidence ?? null,
  });
};

const compareEntries = (left: LegislativeDiffEntry, right: LegislativeDiffEntry): number => {
  const leftKey = left.affectedBlockId ?? left.after?.blockId ?? '';
  const rightKey = right.affectedBlockId ?? right.after?.blockId ?? '';
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};

const samePath = (left: LegislativeDiffSide, right: LegislativeDiffSide): boolean =>
  JSON.stringify(left.path) === JSON.stringify(right.path);

export const createLegislativeStructuralDiff = (options: {
  previous: unknown;
  current: unknown;
  explicitRenumberings?: readonly ExplicitRenumbering[] | undefined;
}): ResultadoValidacao<Readonly<LegislativeStructuralDiff>> => {
  const previous = validarIdentifiedNormaAst(options.previous);
  const current = validarIdentifiedNormaAst(options.current);
  const mappings = explicitRenumberingsSchema.safeParse(options.explicitRenumberings ?? []);
  if (!previous.ok) return previous;
  if (!current.ok) return current;
  if (!mappings.success) return falha(problemasDoZod(mappings.error));

  const before = indexNodes(previous.valor);
  const after = indexNodes(current.valor);
  const entries: LegislativeDiffEntry[] = [];
  const consumedBefore = new Set<string>();
  const consumedAfter = new Set<string>();

  for (const [index, mapping] of mappings.data.entries()) {
    const source = before.get(mapping.fromBlockId);
    const target = after.get(mapping.toBlockId);
    if (source === undefined || target === undefined) {
      return falha([
        criarProblema(
          'decisao_editorial_invalida',
          ['explicitRenumberings', index],
          'A renumeração explícita deve ligar um dispositivo publicado a um dispositivo candidato existente.',
        ),
      ]);
    }
    if (after.has(mapping.fromBlockId) || before.has(mapping.toBlockId)) {
      return falha([
        criarProblema(
          'decisao_editorial_invalida',
          ['explicitRenumberings', index],
          'A renumeração é ambígua: a origem ainda existe na candidata ou o destino já existia na publicação.',
        ),
      ]);
    }
    if (target.node.deviceStatus !== 'renumbered') {
      return falha([
        criarProblema(
          'estado_incompativel',
          ['explicitRenumberings', index],
          'A renumeração exige deviceStatus "renumbered" e evidência oficial explícita.',
          target.node.id,
        ),
      ]);
    }
    consumedBefore.add(mapping.fromBlockId);
    consumedAfter.add(mapping.toBlockId);
    entries.push(
      entry({
        category: 'renumbered',
        affectedBlockId: mapping.fromBlockId,
        before: source,
        after: target,
        renumberingEvidence: mapping.evidence,
      }),
    );
  }

  for (const [blockId, candidate] of after) {
    if (consumedAfter.has(blockId)) continue;
    const published = before.get(blockId);
    if (published === undefined) {
      entries.push(
        entry({ category: 'included', affectedBlockId: blockId, before: null, after: candidate }),
      );
      continue;
    }
    consumedBefore.add(blockId);
    const category: LegislativeDiffCategory =
      candidate.node.deviceStatus === 'revoked' && published.node.deviceStatus !== 'revoked'
        ? 'revoked'
        : candidate.legalValue !== published.legalValue || !samePath(candidate.side, published.side)
          ? 'amended'
          : 'unchanged';
    entries.push(
      entry({ category, affectedBlockId: blockId, before: published, after: candidate }),
    );
  }

  const missingPublished = [...before]
    .filter(([blockId]) => !consumedBefore.has(blockId))
    .map(([, node]) => node.side)
    .sort((left, right) =>
      left.blockId < right.blockId ? -1 : left.blockId > right.blockId ? 1 : 0,
    );
  entries.sort(compareEntries);
  const summary: LegislativeDiffSummary = {
    unchanged: entries.filter(({ category }) => category === 'unchanged').length,
    amended: entries.filter(({ category }) => category === 'amended').length,
    included: entries.filter(({ category }) => category === 'included').length,
    revoked: entries.filter(({ category }) => category === 'revoked').length,
    renumbered: entries.filter(({ category }) => category === 'renumbered').length,
    missingPublished: missingPublished.length,
  };

  return sucesso(
    Object.freeze(
      legislativeStructuralDiffSchema.parse({
        schemaVersion: 1,
        entries,
        missingPublished,
        summary,
        requiresHumanReview:
          missingPublished.length > 0 ||
          entries.some(({ requiresHumanReview }) => requiresHumanReview),
      }),
    ),
  );
};
