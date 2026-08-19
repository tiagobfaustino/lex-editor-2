import {
  calculateRevisionHash,
  editorialCheckpointSchema,
  editorialCommandSchema,
  editorialJournalSchema,
  parseEditorialJournal,
  revisionHashSchema,
  type EditorialCheckpoint,
  type EditorialJournal,
  type RevisionHash,
  type RevisionHashFunction,
} from './index.js';
import { applyEditorialCommand, type EditorialCommandErrorCode } from './apply.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import type { PublicationHistoryEvidence } from './publication-history-authority.js';

export type EditorialReplayErrorCode =
  'invalid_journal' | 'invalid_checkpoint' | 'command_rejected' | 'result_hash_mismatch';

export type EditorialReplayResult =
  | Readonly<{
      ok: true;
      ast: IdentifiedNormaAST;
      revisionHash: RevisionHash;
      replayedEntries: number;
      checkpointUsed: boolean;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: EditorialReplayErrorCode;
        message: string;
        sequence?: number;
        commandErrorCode?: EditorialCommandErrorCode;
      }>;
    }>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const currentJournalRevisionHash = (journal: EditorialJournal): RevisionHash =>
  journal.entries.at(-1)?.resultRevisionHash ?? journal.base.revisionHash;

export const appendEditorialJournalEntry = (
  rawJournal: unknown,
  rawCommand: unknown,
  rawResultRevisionHash: unknown,
  sha256: RevisionHashFunction,
  metadataContext?: Readonly<{
    publicationHistoryEvidence: PublicationHistoryEvidence;
  }>,
): EditorialJournal => {
  const journal = parseEditorialJournal(rawJournal, sha256);
  const command = editorialCommandSchema.parse(rawCommand);
  const resultRevisionHash = revisionHashSchema.parse(rawResultRevisionHash);
  if (command.expectedRevisionHash !== currentJournalRevisionHash(journal)) {
    throw new Error('O comando não parte da revisão atual do diário.');
  }
  return editorialJournalSchema.parse({
    ...clone(journal),
    entries: [
      ...clone(journal.entries),
      {
        sequence: journal.entries.length + 1,
        command,
        resultRevisionHash,
        ...(metadataContext === undefined ? {} : { metadataContext }),
      },
    ],
  });
};

export const createEditorialCheckpoint = (
  rawJournal: unknown,
  ast: unknown,
  checkpointId: string,
  createdAt: string,
  sha256: RevisionHashFunction,
): EditorialCheckpoint => {
  const journal = parseEditorialJournal(rawJournal, sha256);
  const revisionHash = calculateRevisionHash(ast, sha256);
  if (revisionHash !== currentJournalRevisionHash(journal)) {
    throw new Error('O snapshot do checkpoint não representa a revisão atual do diário.');
  }
  return editorialCheckpointSchema.parse({
    schemaVersion: 1,
    checkpointId,
    journalId: journal.journalId,
    projectId: journal.projectId,
    throughSequence: journal.entries.length,
    createdAt,
    revisionHash,
    ast,
  });
};

const checkpointAnchorHash = (
  journal: EditorialJournal,
  throughSequence: number,
): RevisionHash | undefined =>
  throughSequence === 0
    ? journal.base.revisionHash
    : journal.entries[throughSequence - 1]?.resultRevisionHash;

export const replayEditorialJournal = (
  rawJournal: unknown,
  sha256: RevisionHashFunction,
  rawCheckpoint?: unknown,
): EditorialReplayResult => {
  let journal: EditorialJournal;
  try {
    journal = parseEditorialJournal(rawJournal, sha256);
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid_journal',
        message: 'O diário editorial é inválido ou foi adulterado.',
      },
    };
  }

  let ast = clone(journal.base.ast);
  let startSequence = 0;
  let checkpointUsed = false;
  if (rawCheckpoint !== undefined) {
    const parsed = editorialCheckpointSchema.safeParse(rawCheckpoint);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'invalid_checkpoint', message: 'O checkpoint editorial é inválido.' },
      };
    }
    const checkpoint = parsed.data;
    const anchorHash = checkpointAnchorHash(journal, checkpoint.throughSequence);
    let calculatedCheckpointHash: RevisionHash;
    try {
      calculatedCheckpointHash = calculateRevisionHash(checkpoint.ast, sha256);
    } catch {
      return {
        ok: false,
        error: { code: 'invalid_checkpoint', message: 'O snapshot do checkpoint é inválido.' },
      };
    }
    if (
      checkpoint.journalId !== journal.journalId ||
      checkpoint.projectId !== journal.projectId ||
      checkpoint.throughSequence > journal.entries.length ||
      anchorHash === undefined ||
      checkpoint.revisionHash !== anchorHash ||
      calculatedCheckpointHash !== checkpoint.revisionHash
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_checkpoint',
          message: 'O checkpoint não corresponde a uma revisão confirmada deste diário.',
        },
      };
    }
    ast = clone(checkpoint.ast);
    startSequence = checkpoint.throughSequence;
    checkpointUsed = true;
  }

  let revisionHash = calculateRevisionHash(ast, sha256);
  for (const entry of journal.entries.slice(startSequence)) {
    const applied = applyEditorialCommand(ast, entry.command, sha256, {
      ...(entry.metadataContext === undefined
        ? {}
        : {
            publicationHistoryEvidence: entry.metadataContext.publicationHistoryEvidence,
            metadataReplayResultRevisionHash: entry.resultRevisionHash,
          }),
    });
    if (!applied.ok) {
      return {
        ok: false,
        error: {
          code: 'command_rejected',
          message: 'Um comando persistido não pode ser reaplicado com segurança.',
          sequence: entry.sequence,
          commandErrorCode: applied.error.code,
        },
      };
    }
    if (applied.revisionHash !== entry.resultRevisionHash) {
      return {
        ok: false,
        error: {
          code: 'result_hash_mismatch',
          message: 'O resultado reexecutado diverge do hash registrado no diário.',
          sequence: entry.sequence,
        },
      };
    }
    ast = applied.ast;
    revisionHash = applied.revisionHash;
  }

  return {
    ok: true,
    ast,
    revisionHash,
    replayedEntries: journal.entries.length - startSequence,
    checkpointUsed,
  };
};
