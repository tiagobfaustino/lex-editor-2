import { z } from 'zod';

import type { IdentifiedNormaAST, IdentifiedChildNode } from '../ast/nodes.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const BLOCK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const publicationKindSchema = z.enum([
  'initial',
  'legislative_update',
  'editorial_correction',
  'rollback',
]);

const changeDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(280)
  .regex(/^[^\r\n]+$/u);
const blockIdSchema = z.string().min(1).max(240).regex(BLOCK_ID);

export const blockChangeSchema = z.strictObject({
  blockId: blockIdSchema,
  description: changeDescriptionSchema,
});

export const renumberedBlockChangeSchema = z
  .strictObject({
    from: blockIdSchema,
    to: blockIdSchema,
    description: changeDescriptionSchema,
  })
  .refine(({ from, to }) => from !== to, {
    message: 'Uma renumeração deve apontar para outro Block ID.',
    path: ['to'],
  });

export const structuredChangesSchema = z
  .strictObject({
    included: z.array(blockChangeSchema).max(20_000),
    amended: z.array(blockChangeSchema).max(20_000),
    revoked: z.array(blockChangeSchema).max(20_000),
    renumbered: z.array(renumberedBlockChangeSchema).max(20_000),
  })
  .superRefine((changes, context) => {
    const seen = new Set<string>();
    for (const [kind, items] of Object.entries(changes)) {
      for (const [index, item] of items.entries()) {
        const key = 'blockId' in item ? item.blockId : item.from;
        if (seen.has(key)) {
          context.addIssue({
            code: 'custom',
            message: `O Block ID ${key} aparece em mais de uma mudança.`,
            path: [kind, index],
          });
        }
        seen.add(key);
      }
    }
  });

export const updateEntrySchema = z
  .strictObject({
    publicationDate: z.string().regex(ISO_DATE),
    version: z.string().regex(SEMVER),
    publicationNumber: z.number().int().positive(),
    kind: publicationKindSchema,
    sourceSummary: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[^\r\n]+$/u),
    changes: structuredChangesSchema,
    changingLaw: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .regex(/^[^\r\n]+$/u)
      .optional(),
    fullDiffReference: z.url().max(2_048).optional(),
    restoredVersion: z.string().regex(SEMVER).optional(),
    rollbackJustification: z
      .string()
      .trim()
      .min(10)
      .max(1_000)
      .regex(/^[^\r\n]+$/u)
      .optional(),
  })
  .superRefine((entry, context) => {
    if (entry.kind === 'initial') {
      if (entry.version !== '1.0.0') {
        context.addIssue({
          code: 'custom',
          message: 'A publicação inicial deve usar a versão 1.0.0.',
          path: ['version'],
        });
      }
      if (entry.publicationNumber !== 1) {
        context.addIssue({
          code: 'custom',
          message: 'A publicação inicial deve usar numero_publicacao 1.',
          path: ['publicationNumber'],
        });
      }
    }
    if (entry.kind === 'rollback') {
      if (entry.restoredVersion === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Rollback exige a versão restaurada.',
          path: ['restoredVersion'],
        });
      }
      if (entry.rollbackJustification === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Rollback exige justificativa pública.',
          path: ['rollbackJustification'],
        });
      }
    } else if (entry.restoredVersion !== undefined || entry.rollbackJustification !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Dados de restauração só podem aparecer em rollback.',
        path: ['kind'],
      });
    }
  });

export const updateDocumentSchema = z
  .array(updateEntrySchema)
  .min(1)
  .max(10_000)
  .superRefine((entries, context) => {
    const numbers = new Set<number>();
    const versions = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (numbers.has(entry.publicationNumber)) {
        context.addIssue({
          code: 'custom',
          message: 'numero_publicacao deve ser único por lei.',
          path: [index, 'publicationNumber'],
        });
      }
      if (versions.has(entry.version)) {
        context.addIssue({
          code: 'custom',
          message: 'versao_vinculex deve ser única por lei.',
          path: [index, 'version'],
        });
      }
      numbers.add(entry.publicationNumber);
      versions.add(entry.version);
    }
  });

export type PublicationKind = z.infer<typeof publicationKindSchema>;
export type BlockChange = z.infer<typeof blockChangeSchema>;
export type RenumberedBlockChange = z.infer<typeof renumberedBlockChangeSchema>;
export type StructuredChanges = z.infer<typeof structuredChangesSchema>;
export type UpdateEntry = z.infer<typeof updateEntrySchema>;

const PUBLICATION_LABELS: Readonly<Record<PublicationKind, string>> = Object.freeze({
  initial: 'Publicação inicial',
  legislative_update: 'Atualização legislativa',
  editorial_correction: 'Correção editorial',
  rollback: 'Rollback',
});

const CHANGE_SECTIONS = Object.freeze([
  ['included', 'Dispositivos incluídos'],
  ['amended', 'Dispositivos alterados'],
  ['revoked', 'Dispositivos revogados'],
] as const);

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareBlockChanges = (left: BlockChange, right: BlockChange): number =>
  compareText(left.blockId, right.blockId);

const compareRenumbered = (left: RenumberedBlockChange, right: RenumberedBlockChange): number =>
  compareText(left.from, right.from) || compareText(left.to, right.to);

const renderEntry = (entry: UpdateEntry): string => {
  const lines = [
    `## Publicação ${String(entry.publicationNumber)} — ${entry.publicationDate}`,
    '',
    `- **Versão Vinculex:** \`${entry.version}\``,
    `- **Tipo:** ${PUBLICATION_LABELS[entry.kind]}`,
    `- **Origem:** ${entry.sourceSummary}`,
    '- **Atribuição pública:** Equipe editorial Vinculex',
  ];

  if (entry.changingLaw !== undefined) lines.push(`- **Norma alteradora:** ${entry.changingLaw}`);
  if (entry.fullDiffReference !== undefined)
    lines.push(`- **Diff completo:** ${entry.fullDiffReference}`);
  if (entry.kind === 'rollback') {
    lines.push(`- **Versão restaurada:** \`${entry.restoredVersion ?? ''}\``);
    lines.push(`- **Justificativa:** ${entry.rollbackJustification ?? ''}`);
  }

  for (const [key, title] of CHANGE_SECTIONS) {
    lines.push('', `### ${title}`, '');
    const items = [...entry.changes[key]].sort(compareBlockChanges);
    if (items.length === 0) lines.push('- Nenhum.');
    else for (const item of items) lines.push(`- \`${item.blockId}\` — ${item.description}`);
  }

  lines.push('', '### Dispositivos renumerados', '');
  const renumbered = [...entry.changes.renumbered].sort(compareRenumbered);
  if (renumbered.length === 0) lines.push('- Nenhum.');
  else {
    for (const item of renumbered)
      lines.push(`- \`${item.from}\` → \`${item.to}\` — ${item.description}`);
  }
  return lines.join('\n');
};

/** Gera o changelog canônico sem relógio, locale do host ou ordem de entrada. */
export const generateUpdateMarkdown = (entries: readonly UpdateEntry[]): string => {
  const parsed = updateDocumentSchema.parse(entries);
  const ordered = [...parsed].sort(
    (left, right) => right.publicationNumber - left.publicationNumber,
  );
  return `# Atualizações\n\n${ordered.map(renderEntry).join('\n\n')}\n`;
};

type ReferencedNode = Readonly<{
  blockId: string;
  label: string;
  value: string;
  deviceStatus: string;
  renumberedTo?: string;
}>;

const nodeLabel = (node: IdentifiedChildNode): string => {
  if (node.tipo === 'artigo') return `Art. ${node.numero}`;
  if (node.tipo === 'paragrafo') return `§ ${node.numero}`;
  if (node.tipo === 'inciso') return `Inciso ${node.numero}`;
  if (node.tipo === 'alinea') return `Alínea ${node.letra}`;
  if (node.tipo === 'item') return `Item ${node.numero}`;
  if (node.tipo === 'anexo') return `Anexo ${node.numero}`;
  if (node.tipo === 'tabela') return `Tabela ${node.numero}`;
  if (node.tipo === 'pena') return 'Pena';
  return node.titulo;
};

const canonicalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) result[key] = canonicalizeValue(child);
  }
  return result;
};

const ownLegalValue = (node: IdentifiedChildNode): string => {
  const value = { ...node } as Record<string, unknown>;
  delete value['children'];
  delete value['id'];
  delete value['ordem'];
  delete value['sourceRef'];
  delete value['supportingSourceRefs'];
  delete value['parseEvidence'];
  delete value['blockId'];
  delete value['renumeradoPara'];
  return JSON.stringify(canonicalizeValue(value));
};

const collectReferencedNodes = (ast: IdentifiedNormaAST): Map<string, ReferencedNode> => {
  const result = new Map<string, ReferencedNode>();
  const visit = (node: IdentifiedChildNode): void => {
    if ('blockId' in node && typeof node.blockId === 'string') {
      const record = node as unknown as Record<string, unknown>;
      const renumberedTo =
        typeof record['renumeradoPara'] === 'string' ? record['renumeradoPara'] : undefined;
      result.set(node.blockId, {
        blockId: node.blockId,
        label: nodeLabel(node)
          .replace(/[\r\n`]+/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim(),
        value: ownLegalValue(node),
        deviceStatus: node.deviceStatus,
        ...(renumberedTo === undefined ? {} : { renumberedTo }),
      });
    }
    for (const child of node.children) visit(child);
  };
  for (const child of ast.children) visit(child);
  return result;
};

const emptyChanges = (): StructuredChanges => ({
  included: [],
  amended: [],
  revoked: [],
  renumbered: [],
});

/**
 * Deriva o mesmo diff estruturado usado pelo changelog e pela persistência.
 * A primeira publicação considera todos os dispositivos referenciáveis novos.
 */
export const deriveStructuredChanges = (
  previous: IdentifiedNormaAST | null,
  current: IdentifiedNormaAST,
): StructuredChanges => {
  const before =
    previous === null ? new Map<string, ReferencedNode>() : collectReferencedNodes(previous);
  const after = collectReferencedNodes(current);
  const changes = emptyChanges();

  for (const [blockId, node] of after) {
    const old = before.get(blockId);
    if (old === undefined) {
      changes.included.push({ blockId, description: `${node.label} incluído.` });
      continue;
    }
    if (node.renumberedTo !== undefined && node.renumberedTo !== old.renumberedTo) {
      changes.renumbered.push({
        from: blockId,
        to: node.renumberedTo,
        description: `${node.label} renumerado.`,
      });
      continue;
    }
    if (node.deviceStatus === 'revoked' && old.deviceStatus !== 'revoked') {
      changes.revoked.push({ blockId, description: `${node.label} revogado.` });
      continue;
    }
    if (node.value !== old.value) {
      changes.amended.push({ blockId, description: `${node.label} alterado.` });
    }
  }

  for (const [blockId, node] of before) {
    if (!after.has(blockId)) {
      changes.revoked.push({ blockId, description: `${node.label} removido da versão corrente.` });
    }
  }

  changes.included.sort(compareBlockChanges);
  changes.amended.sort(compareBlockChanges);
  changes.revoked.sort(compareBlockChanges);
  changes.renumbered.sort(compareRenumbered);
  return structuredChangesSchema.parse(changes);
};
