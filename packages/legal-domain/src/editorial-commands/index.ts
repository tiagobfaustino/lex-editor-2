import { z } from 'zod';

import { deviceStatusSchema } from '../ast/enums.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { identifiedNormaAstSchema } from '../ast/schemas.js';
import { lawMetadataCommandChangesSchema } from './frontmatter-metadata.js';
import { publicationHistoryEvidenceSchema } from './publication-history-authority.js';

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

const nodeIdSchema = textoObrigatorio('O ID interno do nó', 256);
const reasonSchema = textoObrigatorio('O motivo editorial', 2_000);
const noteSchema = textoObrigatorio('A nota editorial', 2_000);

export const revisionHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, 'Esperado SHA-256 em hexadecimal minúsculo.');

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
  changes: lawMetadataCommandChangesSchema,
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
  metadataContext: z
    .strictObject({
      publicationHistoryEvidence: publicationHistoryEvidenceSchema,
    })
    .optional(),
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
    const operation = entry.command.operation;
    const changesIdentity =
      operation.kind === 'set_law_metadata' &&
      ['sigla', 'tipoNorma', 'numero', 'ano'].some((field) => field in operation.changes);
    if (
      changesIdentity &&
      entry.metadataContext?.publicationHistoryEvidence.state !== 'never_published'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', index, 'metadataContext'],
        message:
          'Uma mudança persistida de identidade exige prova autoritativa de ausência de publicação.',
      });
    }
    expectedRevisionHash = entry.resultRevisionHash;
  }
});

export type RevisionHash = z.infer<typeof revisionHashSchema>;
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

export { editableLawMetadataChangesSchema } from './frontmatter-metadata.js';
export type { EditableLawMetadataChanges } from './frontmatter-metadata.js';
