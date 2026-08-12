import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  publicationApprovalRequestSchema,
  publicationApprovalSchema,
  publicationUuidSchema,
  type PublicationApproval,
} from '../../../src/shared/publication/approval.js';

const publisherIdentitySchema = z.strictObject({
  userId: publicationUuidSchema,
  accountStatus: z.enum(['active', 'suspended', 'disabled']),
  roles: z.array(z.string().min(1).max(80)).max(20),
});

export type PublisherIdentity = z.infer<typeof publisherIdentitySchema>;

export interface PublisherIdentityRepository {
  findByUserId(userId: string): Promise<PublisherIdentity | null>;
}

export type AppendApprovalResult =
  | Readonly<{ inserted: true; approval: PublicationApproval }>
  | Readonly<{ inserted: false; approval: PublicationApproval }>;

export interface PublicationApprovalRepository {
  findByPublicationId(publicationId: string): Promise<PublicationApproval | null>;
  appendIfAbsent(approval: PublicationApproval): Promise<AppendApprovalResult>;
}

export class PublicationApprovalError extends Error {
  constructor(
    readonly code:
      'identity_not_authorized' | 'approval_conflict' | 'approval_not_found' | 'approval_mismatch',
    message: string,
  ) {
    super(message);
  }
}

const assertAuthorizedEditor = async (
  identities: PublisherIdentityRepository,
  actorUserId: string,
): Promise<PublisherIdentity> => {
  const userId = publicationUuidSchema.parse(actorUserId);
  const rawIdentity = await identities.findByUserId(userId);
  if (rawIdentity === null) {
    throw new PublicationApprovalError(
      'identity_not_authorized',
      'A identidade autenticada não está autorizada a aprovar publicações.',
    );
  }
  const identity = publisherIdentitySchema.parse(rawIdentity);
  if (identity.userId !== userId || identity.accountStatus !== 'active') {
    throw new PublicationApprovalError(
      'identity_not_authorized',
      'A identidade autenticada não está ativa para aprovação.',
    );
  }
  if (!identity.roles.includes('editor_juridico')) {
    throw new PublicationApprovalError(
      'identity_not_authorized',
      'A identidade autenticada não possui o papel editorial exigido.',
    );
  }
  return identity;
};

const sameApproval = (left: PublicationApproval, right: PublicationApproval): boolean =>
  left.publicationId === right.publicationId &&
  left.manifestDigest === right.manifestDigest &&
  left.userId === right.userId;

export interface PublicationApprovalAuthority {
  approve(actorUserId: string, request: unknown): Promise<Readonly<PublicationApproval>>;
  assertApproved(input: {
    publicationId: string;
    manifestDigest: string;
    approvedByUserId: string;
  }): Promise<Readonly<PublicationApproval>>;
}

export const createPublicationApprovalAuthority = (options: {
  identities: PublisherIdentityRepository;
  approvals: PublicationApprovalRepository;
  now?: () => Date;
  generateUuid?: () => string;
}): PublicationApprovalAuthority => {
  const now = options.now ?? (() => new Date());
  const generateUuid = options.generateUuid ?? randomUUID;

  return {
    async approve(actorUserId, rawRequest) {
      const request = publicationApprovalRequestSchema.parse(rawRequest);
      const identity = await assertAuthorizedEditor(options.identities, actorUserId);
      const existing = await options.approvals.findByPublicationId(request.publicationId);
      if (existing !== null) {
        const parsed = publicationApprovalSchema.parse(existing);
        if (parsed.userId === identity.userId && parsed.manifestDigest === request.manifestDigest) {
          return Object.freeze(parsed);
        }
        throw new PublicationApprovalError(
          'approval_conflict',
          'A tentativa já possui uma aprovação imutável diferente.',
        );
      }

      const approval = publicationApprovalSchema.parse({
        schemaVersion: 1,
        approvalId: generateUuid(),
        publicationId: request.publicationId,
        manifestDigest: request.manifestDigest,
        userId: identity.userId,
        role: 'editor_juridico',
        approvedAt: now().toISOString(),
      });
      const result = await options.approvals.appendIfAbsent(approval);
      const persisted = publicationApprovalSchema.parse(result.approval);
      if (!sameApproval(persisted, approval)) {
        throw new PublicationApprovalError(
          'approval_conflict',
          'Uma aprovação concorrente diferente venceu para esta tentativa.',
        );
      }
      return Object.freeze(persisted);
    },

    async assertApproved(rawInput) {
      const input = z
        .strictObject({
          publicationId: publicationUuidSchema,
          manifestDigest: publicationApprovalRequestSchema.shape.manifestDigest,
          approvedByUserId: publicationUuidSchema,
        })
        .parse(rawInput);
      const approval = await options.approvals.findByPublicationId(input.publicationId);
      if (approval === null) {
        throw new PublicationApprovalError(
          'approval_not_found',
          'A tentativa não possui aprovação server-side.',
        );
      }
      const parsed = publicationApprovalSchema.parse(approval);
      if (
        parsed.manifestDigest !== input.manifestDigest ||
        parsed.userId !== input.approvedByUserId
      ) {
        throw new PublicationApprovalError(
          'approval_mismatch',
          'A aprovação não corresponde ao ator e ao digest exatos do manifesto.',
        );
      }
      await assertAuthorizedEditor(options.identities, parsed.userId);
      return Object.freeze(parsed);
    },
  };
};

export const createInMemoryPublicationApprovalRepository = (): PublicationApprovalRepository => {
  const approvals = new Map<string, PublicationApproval>();
  return {
    findByPublicationId(publicationId) {
      const approval = approvals.get(publicationUuidSchema.parse(publicationId));
      return Promise.resolve(
        approval === undefined ? null : publicationApprovalSchema.parse(approval),
      );
    },
    appendIfAbsent(rawApproval) {
      const approval = publicationApprovalSchema.parse(rawApproval);
      const existing = approvals.get(approval.publicationId);
      if (existing !== undefined) {
        return Promise.resolve({ inserted: false as const, approval: existing });
      }
      approvals.set(approval.publicationId, approval);
      return Promise.resolve({ inserted: true as const, approval });
    },
  };
};
