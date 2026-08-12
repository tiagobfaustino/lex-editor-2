import {
  legislativeUpdateErrorSchema,
  legislativeUpdateProposalSchema,
  legislativeUpdateRecordSchema,
  updateUuidSchema,
  type LegislativeUpdateError,
  type LegislativeUpdateProposal,
  type LegislativeUpdateQueue,
  type LegislativeUpdateRecord,
  type ProposalUpsertResult,
  type UpdateIdGenerator,
} from './contracts.js';

const ACTIVE_SUPERSEDEABLE = new Set(['pending', 'rejected', 'error']);

const immutableRecord = (value: unknown): LegislativeUpdateRecord =>
  Object.freeze(legislativeUpdateRecordSchema.parse(value));

export class InMemoryLegislativeUpdateQueue implements LegislativeUpdateQueue {
  readonly #records = new Map<string, LegislativeUpdateRecord>();
  readonly #idGenerator: UpdateIdGenerator;
  readonly #now: () => Date;

  constructor(idGenerator: UpdateIdGenerator, now: () => Date = () => new Date()) {
    this.#idGenerator = idGenerator;
    this.#now = now;
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
      return Promise.resolve({ record: refreshed, created: false, supersededUpdateIds: [] });
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
    return Promise.resolve({ record, created: true, supersededUpdateIds: superseded.sort() });
  }

  recordError(rawError: LegislativeUpdateError): Promise<LegislativeUpdateRecord> {
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
      return Promise.resolve(refreshed);
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
    return Promise.resolve(record);
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

  requestReprocess(updateId: string): Promise<LegislativeUpdateRecord> {
    const id = updateUuidSchema.parse(updateId);
    const current = this.#records.get(id);
    if (current === undefined) throw new Error('UPDATE_NOT_FOUND');
    if (!['error', 'rejected'].includes(current.updateReviewStatus)) {
      throw new Error('UPDATE_CANNOT_REPROCESS');
    }
    const requested = immutableRecord({
      ...current,
      retryCount: current.retryCount + 1,
      reprocessRequestedAt: this.#now().toISOString(),
    });
    this.#records.set(id, requested);
    return Promise.resolve(requested);
  }

  #requiredPending(updateId: string): LegislativeUpdateRecord {
    const id = updateUuidSchema.parse(updateId);
    const current = this.#records.get(id);
    if (current === undefined) throw new Error('UPDATE_NOT_FOUND');
    if (current.updateReviewStatus !== 'pending') throw new Error('UPDATE_NOT_PENDING');
    return current;
  }
}
