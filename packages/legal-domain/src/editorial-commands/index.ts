import { z } from 'zod';

import { deviceStatusSchema, legalStatusSchema, tipoNormaSchema } from '../ast/enums.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { identifiedNormaAstSchema } from '../ast/schemas.js';

const textoObrigatorio = (rotulo: string, maximo: number) =>
  z
    .string()
    .max(maximo)
    .check((ctx) => {
      if (ctx.value.trim().length === 0) {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: `${rotulo} não pode ser vazio.`,
        });
      }
    });

const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Esperada data no formato YYYY-MM-DD.')
  .refine((valor) => {
    const [ano, mes, dia] = valor.split('-').map(Number) as [number, number, number];
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return (
      data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia
    );
  }, 'Data inexistente no calendário.');

const nodeIdSchema = textoObrigatorio('O ID interno do nó', 256);
const reasonSchema = textoObrigatorio('O motivo editorial', 2_000);
const noteSchema = textoObrigatorio('A nota editorial', 2_000);

export const revisionHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, 'Esperado SHA-256 em hexadecimal minúsculo.');

export const editableLawMetadataChangesSchema = z
  .strictObject({
    titulo: textoObrigatorio('O título', 500).optional(),
    sigla: textoObrigatorio('A sigla', 80).optional(),
    tipoNorma: tipoNormaSchema.optional(),
    numero: textoObrigatorio('O número da norma', 80).optional(),
    ano: z.int().optional(),
    ramo: textoObrigatorio('O ramo jurídico', 160).optional(),
    fonte: z.url().optional(),
    dataPublicacao: dataSchema.optional(),
    dataAtualizacaoLegal: dataSchema.optional(),
    legalStatus: legalStatusSchema.optional(),
    tags: z.array(textoObrigatorio('A tag', 120)).max(100).optional(),
    revogadaPor: textoObrigatorio('A norma revogadora', 500).nullable().optional(),
    fontesSecundarias: z.array(z.url()).max(100).optional(),
  })
  .check((ctx) => {
    if (Object.keys(ctx.value).length === 0) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: 'A correção de metadados precisa alterar ao menos um campo.',
      });
    }
  });

const replaceNodeTextOperationSchema = z.strictObject({
  kind: z.literal('replace_node_text'),
  targetNodeId: nodeIdSchema,
  field: z.enum([
    'titulo',
    'caput',
    'texto',
    'caption',
    'notaStatus',
    'redacaoAtualDadaPor',
    'renumeradoPara',
  ]),
  value: textoObrigatorio('O novo texto', 200_000),
  reason: reasonSchema,
});

const setDeviceStatusOperationSchema = z.strictObject({
  kind: z.literal('set_device_status'),
  targetNodeId: nodeIdSchema,
  deviceStatus: deviceStatusSchema,
  notaStatus: textoObrigatorio('A nota de estado', 2_000).optional(),
  preservarTextoRevogado: z.boolean().optional(),
  reason: reasonSchema,
});

const moveNodeOperationSchema = z.strictObject({
  kind: z.literal('move_node'),
  targetNodeId: nodeIdSchema,
  newParentNodeId: nodeIdSchema,
  newOrder: z.int().nonnegative(),
  reason: reasonSchema,
});

const setLawMetadataOperationSchema = z.strictObject({
  kind: z.literal('set_law_metadata'),
  changes: editableLawMetadataChangesSchema,
  reason: reasonSchema,
});

const confirmParseInterpretationOperationSchema = z.strictObject({
  kind: z.literal('confirm_parse_interpretation'),
  targetNodeId: nodeIdSchema,
  reason: reasonSchema,
});

const confirmWarningOperationSchema = z.strictObject({
  kind: z.literal('confirm_warning'),
  warningCode: textoObrigatorio('O código do aviso', 120).regex(
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/u,
    'O código do aviso deve usar snake_case minúsculo.',
  ),
  warningFingerprint: revisionHashSchema,
  note: noteSchema.optional(),
});

export const editorialOperationSchema = z.discriminatedUnion('kind', [
  replaceNodeTextOperationSchema,
  setDeviceStatusOperationSchema,
  moveNodeOperationSchema,
  setLawMetadataOperationSchema,
  confirmParseInterpretationOperationSchema,
  confirmWarningOperationSchema,
]);

export const editorialCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  localActorId: textoObrigatorio('O ator local', 160),
  occurredAt: z.iso.datetime({ offset: true }),
  expectedRevisionHash: revisionHashSchema,
  operation: editorialOperationSchema,
});

export const revisionSnapshotSchema: z.ZodType<RevisionSnapshot> = z.strictObject({
  revisionHash: revisionHashSchema,
  ast: identifiedNormaAstSchema,
});

export const editorialCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(1),
  checkpointId: z.uuid(),
  journalId: z.uuid(),
  projectId: z.uuid(),
  throughSequence: z.int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  revisionHash: revisionHashSchema,
  ast: identifiedNormaAstSchema,
});

export const editorialJournalEntrySchema = z.strictObject({
  sequence: z.int().positive(),
  command: editorialCommandSchema,
  resultRevisionHash: revisionHashSchema,
});

const editorialJournalShapeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  journalId: z.uuid(),
  projectId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  base: revisionSnapshotSchema,
  entries: z.array(editorialJournalEntrySchema).max(100_000),
});

export const editorialJournalSchema = editorialJournalShapeSchema.superRefine((journal, ctx) => {
  const commandIds = new Set<string>();
  let expectedRevisionHash = journal.base.revisionHash;

  for (const [index, entry] of journal.entries.entries()) {
    if (entry.sequence !== index + 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', index, 'sequence'],
        message: 'A sequência do diário deve ser contínua e iniciar em 1.',
      });
    }
    if (commandIds.has(entry.command.commandId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', index, 'command', 'commandId'],
        message: 'Um comando não pode aparecer duas vezes no diário.',
      });
    }
    commandIds.add(entry.command.commandId);
    if (entry.command.expectedRevisionHash !== expectedRevisionHash) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', index, 'command', 'expectedRevisionHash'],
        message: 'O comando não parte da revisão produzida pela entrada anterior.',
      });
    }
    expectedRevisionHash = entry.resultRevisionHash;
  }
});

export type RevisionHash = z.infer<typeof revisionHashSchema>;
export type EditableLawMetadataChanges = z.infer<typeof editableLawMetadataChangesSchema>;
export type EditorialOperation = z.infer<typeof editorialOperationSchema>;
export type EditorialCommand = z.infer<typeof editorialCommandSchema>;
export type EditorialJournalEntry = z.infer<typeof editorialJournalEntrySchema>;
export type EditorialJournal = z.infer<typeof editorialJournalSchema>;
export type EditorialCheckpoint = z.infer<typeof editorialCheckpointSchema>;

export interface RevisionSnapshot {
  readonly revisionHash: RevisionHash;
  readonly ast: IdentifiedNormaAST;
}

export type RevisionHashFunction = (canonicalRevision: string) => string;

export const canonicalizeRevision = (ast: unknown): string =>
  JSON.stringify(identifiedNormaAstSchema.parse(ast));

export const calculateRevisionHash = (ast: unknown, sha256: RevisionHashFunction): RevisionHash =>
  revisionHashSchema.parse(sha256(canonicalizeRevision(ast)));

export const parseEditorialJournal = (
  input: unknown,
  sha256: RevisionHashFunction,
): EditorialJournal => {
  const journal = editorialJournalSchema.parse(input);
  const calculatedBaseHash = calculateRevisionHash(journal.base.ast, sha256);
  if (calculatedBaseHash !== journal.base.revisionHash) {
    throw new Error('O hash da revisão-base não corresponde ao snapshot do diário.');
  }
  return journal;
};
