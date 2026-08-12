import { identifiedNormaAstSchema } from '../ast/schemas.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import {
  calculateRevisionHash,
  parseEditorialJournal,
  type EditorialJournal,
  type RevisionHash,
  type RevisionHashFunction,
} from './index.js';
import { currentJournalRevisionHash, replayEditorialJournal } from './replay.js';

export type EditorialReprocessingResult =
  | Readonly<{
      ok: true;
      reprocessingOutcome: 'unchanged_base' | 'replaced_unedited_base';
      journal: EditorialJournal;
      ast: IdentifiedNormaAST;
      revisionHash: RevisionHash;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: 'editorial_reprocessing_conflict' | 'journal_replay_failed';
        message: string;
        previousBaseRevisionHash: RevisionHash;
        incomingBaseRevisionHash: RevisionHash;
        currentRevisionHash: RevisionHash;
        preservedCommandIds: readonly string[];
      }>;
    }>;

/**
 * Compara uma nova extração com a base do diário sem descartar correções.
 * Uma base alterada com comandos confirmados sempre vira conflito explícito;
 * a decisão de rebase pertence ao editor, não a uma heurística silenciosa.
 */
export const reconcileEditorialReprocessing = (
  rawJournal: unknown,
  rawIncomingBase: unknown,
  sha256: RevisionHashFunction,
): EditorialReprocessingResult => {
  const journal = parseEditorialJournal(rawJournal, sha256);
  const incomingBase = identifiedNormaAstSchema.parse(rawIncomingBase);
  const incomingBaseRevisionHash = calculateRevisionHash(incomingBase, sha256);
  const currentRevisionHash = currentJournalRevisionHash(journal);
  const preservedCommandIds = journal.entries.map(({ command }) => command.commandId);

  if (incomingBaseRevisionHash === journal.base.revisionHash) {
    const replayed = replayEditorialJournal(journal, sha256);
    if (!replayed.ok) {
      return {
        ok: false,
        error: {
          code: 'journal_replay_failed',
          message: 'O diário existente não pode ser reaplicado com segurança.',
          previousBaseRevisionHash: journal.base.revisionHash,
          incomingBaseRevisionHash,
          currentRevisionHash,
          preservedCommandIds,
        },
      };
    }
    return {
      ok: true,
      reprocessingOutcome: 'unchanged_base',
      journal,
      ast: replayed.ast,
      revisionHash: replayed.revisionHash,
    };
  }

  if (journal.entries.length > 0) {
    return {
      ok: false,
      error: {
        code: 'editorial_reprocessing_conflict',
        message: 'A nova extração diverge da base que recebeu correções editoriais.',
        previousBaseRevisionHash: journal.base.revisionHash,
        incomingBaseRevisionHash,
        currentRevisionHash,
        preservedCommandIds,
      },
    };
  }

  const replacedJournal = parseEditorialJournal(
    {
      ...journal,
      base: { revisionHash: incomingBaseRevisionHash, ast: incomingBase },
    },
    sha256,
  );
  return {
    ok: true,
    reprocessingOutcome: 'replaced_unedited_base',
    journal: replacedJournal,
    ast: incomingBase,
    revisionHash: incomingBaseRevisionHash,
  };
};
