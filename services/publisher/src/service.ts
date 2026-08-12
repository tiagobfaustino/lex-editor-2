import { publicationUuidSchema } from '../../../src/shared/publication/manifest.js';
import type { PublicationApprovalAuthority } from './approval.js';
import type { PublisherGitRepository } from './git-repository.js';
import {
  publishCandidateRequestSchema,
  validatePublicationCandidate,
  type PublicationBaselineRepository,
} from './validation.js';
import {
  publishValidatedCandidate,
  type PublisherAttemptRecord,
  type PublisherAttemptRepository,
  type PublisherTransactionGateway,
} from './workflow.js';

export interface PublisherAuthenticator {
  authenticate(accessToken: string): Promise<Readonly<{ userId: string }> | null>;
}

export class PublisherAuthenticationError extends Error {
  constructor() {
    super('A autenticação editorial é inválida ou expirou.');
  }
}

const authenticate = async (
  authenticator: PublisherAuthenticator,
  accessToken: string,
): Promise<string> => {
  if (accessToken.length < 16 || accessToken.length > 16_384) {
    throw new PublisherAuthenticationError();
  }
  const identity = await authenticator.authenticate(accessToken);
  if (identity === null) throw new PublisherAuthenticationError();
  return publicationUuidSchema.parse(identity.userId);
};

export const createPublisherService = (dependencies: {
  authenticator: PublisherAuthenticator;
  approvals: PublicationApprovalAuthority;
  git: PublisherGitRepository;
  baselines: PublicationBaselineRepository;
  attempts: PublisherAttemptRepository;
  transaction: PublisherTransactionGateway;
}) => ({
  async approve(accessToken: string, request: unknown) {
    const userId = await authenticate(dependencies.authenticator, accessToken);
    return dependencies.approvals.approve(userId, request);
  },

  async getAttempt(accessToken: string, publicationId: string): Promise<PublisherAttemptRecord> {
    const userId = await authenticate(dependencies.authenticator, accessToken);
    const parsedPublicationId = publicationUuidSchema.parse(publicationId);
    const attempt = await dependencies.attempts.findByPublicationId(parsedPublicationId, userId);
    if (attempt === null) throw new PublisherAuthenticationError();
    return attempt;
  },

  async publish(accessToken: string, rawRequest: unknown): Promise<PublisherAttemptRecord> {
    const userId = await authenticate(dependencies.authenticator, accessToken);
    const request = publishCandidateRequestSchema.parse(rawRequest);
    const published = await dependencies.attempts.findPublished(
      request.publicationId,
      request.candidateSha,
      userId,
    );
    if (published !== null) return published;
    const candidate = await validatePublicationCandidate({
      request,
      authenticatedUserId: userId,
      git: dependencies.git,
      approvals: dependencies.approvals,
      baselines: dependencies.baselines,
    });
    return publishValidatedCandidate({
      candidate,
      git: dependencies.git,
      attempts: dependencies.attempts,
      transaction: dependencies.transaction,
    });
  },
});
