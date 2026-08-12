import type { PublisherGitRepository } from './git-repository.js';
import type { PublicationSyncPayload, ValidatedPublicationCandidate } from './validation.js';

export type PublisherAttemptStage = 'pushed' | 'syncing' | 'published' | 'failed';

export interface PublisherAttemptRecord {
  readonly publicationId: string;
  readonly candidateSha: string;
  readonly manifestDigest: string;
  readonly publicationAttemptStatus: PublisherAttemptStage;
  readonly resumeFromStatus: 'pushed' | 'syncing' | null;
  readonly publishedVersionId: string | null;
}

export interface PublisherAttemptRepository {
  findByPublicationId(
    publicationId: string,
    actorUserId: string,
  ): Promise<PublisherAttemptRecord | null>;
  findPublished(
    publicationId: string,
    candidateSha: string,
    actorUserId: string,
  ): Promise<PublisherAttemptRecord | null>;
  prepare(candidate: ValidatedPublicationCandidate): Promise<PublisherAttemptRecord>;
  markSyncing(publicationId: string, candidateSha: string): Promise<PublisherAttemptRecord>;
  markFailed(
    publicationId: string,
    candidateSha: string,
    resumeFromStatus: 'pushed' | 'syncing',
    failureCode: 'promotion_conflict' | 'database_unavailable' | 'transaction_rejected',
  ): Promise<PublisherAttemptRecord>;
}

export interface PublisherTransactionGateway {
  publishValidated(payload: PublicationSyncPayload): Promise<PublisherAttemptRecord>;
}

export class PublisherWorkflowError extends Error {
  constructor(
    readonly code: 'attempt_conflict' | 'promotion_conflict' | 'sync_failed',
    message: string,
  ) {
    super(message);
  }
}

const assertSameAttempt = (
  attempt: PublisherAttemptRecord,
  candidate: ValidatedPublicationCandidate,
): void => {
  if (
    attempt.publicationId !== candidate.publicationId ||
    attempt.candidateSha !== candidate.candidateSha ||
    attempt.manifestDigest !== candidate.manifestDigest
  ) {
    throw new PublisherWorkflowError(
      'attempt_conflict',
      'A tentativa persistida diverge do candidato validado.',
    );
  }
};

export const publishValidatedCandidate = async (options: {
  candidate: ValidatedPublicationCandidate;
  git: PublisherGitRepository;
  attempts: PublisherAttemptRepository;
  transaction: PublisherTransactionGateway;
}): Promise<PublisherAttemptRecord> => {
  let attempt: PublisherAttemptRecord;
  try {
    attempt = await options.attempts.prepare(options.candidate);
  } catch {
    let observed: PublisherAttemptRecord | null = null;
    try {
      observed = await options.attempts.findByPublicationId(
        options.candidate.publicationId,
        options.candidate.manifest.approvedBy.userId,
      );
    } catch {
      // The stable workflow error below deliberately hides database and
      // transport details from callers.
    }
    if (observed === null) {
      throw new PublisherWorkflowError(
        'sync_failed',
        'A preparação não foi confirmada; a tentativa pode ser repetida com segurança.',
      );
    }
    attempt = observed;
  }
  assertSameAttempt(attempt, options.candidate);
  if (attempt.publicationAttemptStatus === 'published') return attempt;

  const resumeStage =
    attempt.publicationAttemptStatus === 'failed'
      ? attempt.resumeFromStatus
      : attempt.publicationAttemptStatus;
  let canonicalPromoted = options.candidate.canonicalAlreadyPromoted;
  if (resumeStage === 'pushed' && !canonicalPromoted) {
    try {
      await options.git.promoteExactCommit(
        options.candidate.candidateSha,
        options.candidate.manifest.expectedBase.gitCommitSha,
      );
      canonicalPromoted = true;
    } catch {
      // A atualização remota pode ter sido aceita antes de a resposta se
      // perder. Consultar a ponta evita transformar sucesso em conflito.
      try {
        canonicalPromoted =
          (await options.git.getCanonicalSha()) === options.candidate.candidateSha;
      } catch {
        canonicalPromoted = false;
      }
      if (!canonicalPromoted) {
        try {
          await options.attempts.markFailed(
            options.candidate.publicationId,
            options.candidate.candidateSha,
            'pushed',
            'promotion_conflict',
          );
        } catch {
          // The candidate SHA remains immutable and a retry re-reads remote
          // state. Do not expose persistence internals in the public error.
        }
        throw new PublisherWorkflowError(
          'promotion_conflict',
          'A base canônica mudou; a publicação precisa ser recalculada e aprovada novamente.',
        );
      }
    }
  }

  if (!canonicalPromoted) {
    throw new PublisherWorkflowError(
      'attempt_conflict',
      'O estágio persistido não possui evidência da promoção canônica.',
    );
  }
  try {
    attempt = await options.attempts.markSyncing(
      options.candidate.publicationId,
      options.candidate.candidateSha,
    );
  } catch {
    let observed: PublisherAttemptRecord | null = null;
    try {
      observed = await options.attempts.findByPublicationId(
        options.candidate.publicationId,
        options.candidate.manifest.approvedBy.userId,
      );
    } catch {
      // The stable workflow error below deliberately hides database and
      // transport details from callers.
    }
    if (observed === null) {
      throw new PublisherWorkflowError(
        'sync_failed',
        'A sincronização não foi confirmada; a tentativa pode ser repetida com segurança.',
      );
    }
    attempt = observed;
  }
  assertSameAttempt(attempt, options.candidate);
  if (attempt.publicationAttemptStatus === 'published' && attempt.publishedVersionId !== null) {
    return attempt;
  }
  if (attempt.publicationAttemptStatus !== 'syncing') {
    throw new PublisherWorkflowError(
      'sync_failed',
      'A sincronização não foi confirmada; a tentativa pode ser repetida com segurança.',
    );
  }

  try {
    const published = await options.transaction.publishValidated(options.candidate.payload);
    assertSameAttempt(published, options.candidate);
    if (
      published.publicationAttemptStatus !== 'published' ||
      published.publishedVersionId === null
    ) {
      throw new PublisherWorkflowError(
        'sync_failed',
        'A transação não confirmou a versão publicada.',
      );
    }
    return published;
  } catch (error) {
    // The transaction may have committed even when its response was lost. Read
    // the authoritative attempt before recording a failure so a successful
    // publication is never downgraded or reported as failed.
    try {
      const observed = await options.attempts.findByPublicationId(
        options.candidate.publicationId,
        options.candidate.manifest.approvedBy.userId,
      );
      if (observed !== null) {
        assertSameAttempt(observed, options.candidate);
        if (
          observed.publicationAttemptStatus === 'published' &&
          observed.publishedVersionId !== null
        ) {
          return observed;
        }
      }
    } catch (recoveryError) {
      if (recoveryError instanceof PublisherWorkflowError) throw recoveryError;
    }

    try {
      await options.attempts.markFailed(
        options.candidate.publicationId,
        options.candidate.candidateSha,
        'syncing',
        error instanceof PublisherWorkflowError ? 'transaction_rejected' : 'database_unavailable',
      );
    } catch {
      // A concurrent retry may have completed the attempt between the read and
      // this write. Preserve the stable resumable error instead of leaking a
      // repository/transport exception.
    }
    if (error instanceof PublisherWorkflowError) throw error;
    throw new PublisherWorkflowError(
      'sync_failed',
      'O commit foi promovido, mas a sincronização permanece pendente e retomável.',
    );
  }
};
