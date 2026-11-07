import { z } from 'zod';

const updateUuidSchema = z.uuid();

export interface LegislativeUpdateReprocessAuthenticator {
  authenticate(accessToken: string): Promise<Readonly<{ userId: string }> | null>;
}

export interface LegislativeUpdateReprocessRequester {
  request(
    updateId: string,
    actorUserId: string,
    requestId?: string,
  ): Promise<LegislativeUpdateReprocessDecision>;
}

export const legislativeUpdateReprocessDecisionSchema = z.strictObject({
  updateId: updateUuidSchema,
  updateReviewStatus: z.enum(['pending', 'approved', 'rejected', 'superseded', 'error']),
  publicationId: updateUuidSchema.nullable(),
  retryCount: z.int().nonnegative(),
  reprocessRequested: z.literal(true),
});

export type LegislativeUpdateReprocessDecision = z.infer<
  typeof legislativeUpdateReprocessDecisionSchema
>;

export class LegislativeUpdateReprocessAuthenticationError extends Error {}

export const createLegislativeUpdateReprocessService = (options: {
  authenticator: LegislativeUpdateReprocessAuthenticator;
  requester: LegislativeUpdateReprocessRequester;
}) => ({
  async request(
    accessToken: string,
    updateId: string,
    requestId?: string,
  ): Promise<LegislativeUpdateReprocessDecision> {
    const identity = await options.authenticator.authenticate(accessToken);
    if (identity === null) throw new LegislativeUpdateReprocessAuthenticationError();
    return options.requester.request(
      updateUuidSchema.parse(updateId),
      updateUuidSchema.parse(identity.userId),
      requestId === undefined ? undefined : updateUuidSchema.parse(requestId),
    );
  },
});
