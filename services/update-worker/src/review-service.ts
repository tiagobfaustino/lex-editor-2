import {
  updateUuidSchema,
  type LegislativeUpdateQueue,
  type LegislativeUpdateRecord,
} from './contracts.js';

export interface LegislativeUpdatePublicationGateway {
  prepareLegislativeUpdate(
    record: LegislativeUpdateRecord,
    actorUserId: string,
  ): Promise<Readonly<{ publicationId: string }>>;
}

/**
 * Liga a decisão editorial ao fluxo seguro da Feature 007. Preparar artefatos
 * não publica; a aprovação é persistida antes de qualquer execução posterior.
 */
export const createLegislativeUpdateReviewService = (options: {
  queue: LegislativeUpdateQueue;
  publication: LegislativeUpdatePublicationGateway;
}) => ({
  async approve(updateId: string, actorUserId: string): Promise<LegislativeUpdateRecord> {
    const id = updateUuidSchema.parse(updateId);
    const actor = updateUuidSchema.parse(actorUserId);
    const record = await options.queue.findById(id);
    if (record === null) throw new Error('UPDATE_NOT_FOUND');
    if (record.updateReviewStatus !== 'pending' || record.diff === null) {
      throw new Error('UPDATE_NOT_PENDING');
    }
    const prepared = await options.publication.prepareLegislativeUpdate(record, actor);
    return options.queue.approve(id, actor, updateUuidSchema.parse(prepared.publicationId));
  },

  reject(updateId: string, actorUserId: string, reason: string): Promise<LegislativeUpdateRecord> {
    return options.queue.reject(
      updateUuidSchema.parse(updateId),
      updateUuidSchema.parse(actorUserId),
      reason,
    );
  },

  requestReprocess(updateId: string): Promise<LegislativeUpdateRecord> {
    return options.queue.requestReprocess(updateUuidSchema.parse(updateId));
  },
});
