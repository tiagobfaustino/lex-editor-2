import { z } from 'zod';

import {
  legislativeCandidateArtifactSchema,
  type LegislativeCandidateArtifact,
} from './candidate-artifacts.js';

import {
  legislativeUpdateErrorSchema,
  legislativeUpdateProposalSchema,
  legislativeUpdateRecordSchema,
  updateUuidSchema,
  type LegislativeUpdateError,
  type ClaimedLegislativeUpdateReprocess,
  type LegislativeUpdateProposal,
  type LegislativeUpdateQueue,
  type LegislativeUpdateReprocessOutcome,
  type LegislativeUpdateRecord,
  type ProposalUpsertResult,
  type UpdateIdGenerator,
} from './contracts.js';

const ACTIVE_SUPERSEDEABLE = new Set(['pending', 'rejected', 'error']);

const immutableRecord = (value: unknown): LegislativeUpdateRecord =>
  Object.freeze(legislativeUpdateRecordSchema.parse(value));

export class InMemoryLegislativeUpdateQueue implements LegislativeUpdateQueue {
  readonly #candidateArtifacts = new Map<string, LegislativeCandidateArtifact>();
  readonly #records = new Map<string, LegislativeUpdateRecord>();
  readonly #idGenerator: UpdateIdGenerator;
  readonly #now: () => Date;
  readonly #reprocessRequests = new Map<
    string,
    { updateId: string; claimed: boolean; completed: boolean }
  >();
  readonly #currentReprocessRequest = new Map<string, string>();

  constructor(idGenerator: UpdateIdGenerator, now: () => Date = () => new Date()) {
    this.#idGenerator = idGenerator;
    this.#now = now;
  }

  saveCandidateArtifact(rawArtifact: LegislativeCandidateArtifact): Promise<void> {
    const artifact = legislativeCandidateArtifactSchema.parse(rawArtifact);
    const previous = this.#candidateArtifacts.get(artifact.candidateArtifactId);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(artifact))
      throw new Error('UPDATE_CANDIDATE_ARTIFACT_CONFLICT');
    this.#candidateArtifacts.set(artifact.candidateArtifactId, artifact);
    return Promise.resolve();
  }

  getCandidate(updateId: string): Promise<LegislativeCandidateArtifact | null> {
    const record = this.#records.get(updateUuidSchema.parse(updateId));
    const artifact =
      record?.candidateArtifactId === null || record?.candidateArtifactId === undefined
        ? undefined
        : this.#candidateArtifacts.get(record.candidateArtifactId);
    return Promise.resolve(
      artifact === undefined ? null : legislativeCandidateArtifactSchema.parse(artifact),
    );
  }

  upsertProposal(rawProposal: LegislativeUpdateProposal): Promise<ProposalUpsertResult> {
    const proposal = legislativeUpdateProposalSchema.parse(rawProposal);
    const duplicate = [...this.#records.values()].find(
      (record) => record.detectionKey === proposal.detectionKey,
    );
    if (duplicate !== undefined) {
      const refreshed = immutableRecord({
        ...duplicate,
        detectionCount: duplicate.detectionCount + 1,
        lastDetectedAt: proposal.detectedAt,
      });
      this.#records.set(refreshed.id, refreshed);
      return Promise.resolve({
        record: refreshed,
        updateId: refreshed.id,
        created: false,
        supersededUpdateIds: [],
      });
    }

    const id = updateUuidSchema.parse(this.#idGenerator());
    const superseded: string[] = [];
    for (const previous of this.#records.values()) {
      if (
        previous.lawId === proposal.lawId &&
        previous.baseVersionId === proposal.baseVersionId &&
        ACTIVE_SUPERSEDEABLE.has(previous.updateReviewStatus)
      ) {
        superseded.push(previous.id);
        this.#records.set(
          previous.id,
          immutableRecord({
            ...previous,
            updateReviewStatus: 'superseded',
            supersededByUpdateId: id,
          }),
        );
      }
    }

    const record = immutableRecord({
      ...proposal,
      id,
      updateReviewStatus: 'pending',
      detectionCount: 1,
      lastDetectedAt: proposal.detectedAt,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectionReason: null,
      errorCode: null,
      retryCount: 0,
      supersededByUpdateId: null,
      publicationId: null,
      reprocessRequestedAt: null,
    });
    this.#records.set(id, record);
    return Promise.resolve({
      record,
      updateId: record.id,
      created: true,
      supersededUpdateIds: superseded.sort(),
    });
  }

  recordError(rawError: LegislativeUpdateError): Promise<Readonly<{ updateId: string }>> {
    const error = legislativeUpdateErrorSchema.parse(rawError);
    const duplicate = [...this.#records.values()].find(
      (record) => record.detectionKey === error.failureKey,
    );
    if (duplicate !== undefined) {
      const refreshed = immutableRecord({
        ...duplicate,
        updateReviewStatus: 'error',
        errorCode: error.errorCode,
        detectionCount: duplicate.detectionCount + 1,
        retryCount: duplicate.retryCount + 1,
        lastDetectedAt: error.occurredAt,
        reprocessRequestedAt: null,
      });
      this.#records.set(refreshed.id, refreshed);
      return Promise.resolve(Object.freeze({ updateId: refreshed.id }));
    }

    const id = updateUuidSchema.parse(this.#idGenerator());
    const record = immutableRecord({
      id,
      lawId: error.lawId,
      lawSigla: error.lawSigla,
      lawTitle: error.lawTitle,
      sourceUrl: error.sourceUrl,
      baseVersionId: error.baseVersionId,
      baseNormativeSha256: error.baseNormativeSha256,
      candidateNormativeSha256: null,
      detectionKey: error.failureKey,
      sourceArtifacts: [],
      candidateArtifactId: null,
      diff: null,
      overallConfidence: 'low',
      requiresHumanReview: true,
      detectedAt: error.occurredAt,
      updateReviewStatus: 'error',
      detectionCount: 1,
      lastDetectedAt: error.occurredAt,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectionReason: null,
      errorCode: error.errorCode,
      retryCount: 0,
      supersededByUpdateId: null,
      publicationId: null,
      reprocessRequestedAt: null,
    });
    this.#records.set(id, record);
    return Promise.resolve(Object.freeze({ updateId: record.id }));
  }

  findById(updateId: string): Promise<LegislativeUpdateRecord | null> {
    return Promise.resolve(this.#records.get(updateUuidSchema.parse(updateId)) ?? null);
  }

  list(): Promise<readonly LegislativeUpdateRecord[]> {
    return Promise.resolve(
      [...this.#records.values()].sort((left, right) =>
        left.detectedAt > right.detectedAt ? -1 : left.detectedAt < right.detectedAt ? 1 : 0,
      ),
    );
  }

  approve(
    updateId: string,
    actorUserId: string,
    publicationId: string,
  ): Promise<LegislativeUpdateRecord> {
    const current = this.#requiredPending(updateId);
    const approved = immutableRecord({
      ...current,
      updateReviewStatus: 'approved',
      approvedBy: updateUuidSchema.parse(actorUserId),
      approvedAt: this.#now().toISOString(),
      publicationId: updateUuidSchema.parse(publicationId),
    });
    this.#records.set(approved.id, approved);
    return Promise.resolve(approved);
  }

  reject(updateId: string, actorUserId: string, reason: string): Promise<LegislativeUpdateRecord> {
    const rejectedBy = updateUuidSchema.parse(actorUserId);
    const current = this.#requiredPending(updateId);
    const rejected = immutableRecord({
      ...current,
      updateReviewStatus: 'rejected',
      rejectedBy,
      rejectionReason: reason,
    });
    this.#records.set(rejected.id, rejected);
    return Promise.resolve(rejected);
  }

  requestReprocess(updateId: string, requestId?: string): Promise<LegislativeUpdateRecord> {
    const id = updateUuidSchema.parse(updateId);
    const current = this.#records.get(id);
    if (current === undefined) throw new Error('UPDATE_NOT_FOUND');
    const activeId = this.#currentReprocessRequest.get(id);
    const active = activeId === undefined ? undefined : this.#reprocessRequests.get(activeId);
    const requestedId = updateUuidSchema.parse(
      requestId ?? (active?.completed === false ? activeId : crypto.randomUUID()),
    );
    const existing = this.#reprocessRequests.get(requestedId);
    if (existing !== undefined) {
      if (existing.updateId !== id) throw new Error('UPDATE_REPROCESS_REQUEST_CONFLICT');
      return Promise.resolve(current);
    }
    if (!['error', 'rejected'].includes(current.updateReviewStatus))
      throw new Error('UPDATE_CANNOT_REPROCESS');
    if (active?.completed === false) throw new Error('UPDATE_REPROCESS_IN_PROGRESS');
    const requested = immutableRecord({
      ...current,
      retryCount: current.retryCount + 1,
      reprocessRequestedAt: this.#now().toISOString(),
    });
    this.#records.set(id, requested);
    this.#currentReprocessRequest.set(id, requestedId);
    this.#reprocessRequests.set(requestedId, { updateId: id, claimed: false, completed: false });
    return Promise.resolve(requested);
  }

  claimReprocessRequests(limit: number): Promise<readonly ClaimedLegislativeUpdateReprocess[]> {
    const parsedLimit = z.int().min(1).max(100).parse(limit);
    const claimed: ClaimedLegislativeUpdateReprocess[] = [];
    for (const record of this.#records.values()) {
      const requestId = this.#currentReprocessRequest.get(record.id);
      const request = requestId === undefined ? undefined : this.#reprocessRequests.get(requestId);
      if (
        claimed.length >= parsedLimit ||
        requestId === undefined ||
        request === undefined ||
        request.claimed ||
        request.completed
      )
        continue;
      request.claimed = true;
      this.#records.set(record.id, immutableRecord({ ...record, reprocessRequestedAt: null }));
      claimed.push(Object.freeze({ updateId: record.id, lawId: record.lawId, requestId }));
    }
    return Promise.resolve(claimed);
  }

  completeReprocess(
    updateId: string,
    requestId: string,
    outcome: LegislativeUpdateReprocessOutcome,
    detailCode: string | null,
  ): Promise<boolean> {
    const id = updateUuidSchema.parse(updateId);
    const parsedRequestId = updateUuidSchema.parse(requestId);
    z.enum(['completed', 'failed']).parse(outcome);
    z.string()
      .regex(/^[A-Z][A-Z0-9_]{2,79}$/u)
      .nullable()
      .parse(detailCode);
    const request = this.#reprocessRequests.get(parsedRequestId);
    if (
      this.#currentReprocessRequest.get(id) !== parsedRequestId ||
      request?.updateId !== id ||
      !request.claimed ||
      request.completed
    )
      return Promise.resolve(false);
    request.completed = true;
    const record = this.#records.get(id);
    if (record !== undefined)
      this.#records.set(id, immutableRecord({ ...record, reprocessRequestedAt: null }));
    return Promise.resolve(true);
  }

  #requiredPending(updateId: string): LegislativeUpdateRecord {
    const id = updateUuidSchema.parse(updateId);
    const current = this.#records.get(id);
    if (current === undefined) throw new Error('UPDATE_NOT_FOUND');
    if (current.updateReviewStatus !== 'pending') throw new Error('UPDATE_NOT_PENDING');
    return current;
  }
}
