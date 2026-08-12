import { createHash, randomUUID } from 'node:crypto';

import {
  publicationUuidSchema,
  serializePublicationManifest,
} from '../../shared/publication/manifest.js';

export * from '../../shared/publication/manifest.js';

export interface PublicationIdentifiers {
  readonly publicationId: string;
  readonly idempotencyKey: string;
}

export const createPublicationIdentifiers = (
  generateUuid: () => string = randomUUID,
): Readonly<PublicationIdentifiers> => {
  const publicationId = publicationUuidSchema.parse(generateUuid());
  const idempotencyKey = publicationUuidSchema.parse(generateUuid());
  if (publicationId === idempotencyKey) {
    throw new Error('The publication and idempotency identifiers must be distinct.');
  }
  return Object.freeze({ publicationId, idempotencyKey });
};

export const calculatePublicationManifestDigest = (input: unknown): string =>
  createHash('sha256').update(serializePublicationManifest(input), 'utf8').digest('hex');
