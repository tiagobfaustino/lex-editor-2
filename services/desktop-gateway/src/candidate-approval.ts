import { createHash } from 'node:crypto';
import { calculateNormativeHash, identifiedNormaAstSchema } from '@lex-editor/legal-domain';

import {
  parseCanonicalPublicationManifest,
  serializeCanonicalJson,
} from '../../../src/shared/publication/manifest.js';
import type { LegislativeCandidateArtifact } from '../../update-worker/src/candidate-artifacts.js';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const identities = (node: unknown): unknown => {
  const value = node as Record<string, unknown>;
  return {
    blockId: value['blockId'] ?? null,
    blockIdStatus: value['blockIdStatus'] ?? null,
    renumeradoPara: value['renumeradoPara'] ?? null,
    children: Array.isArray(value['children']) ? value['children'].map(identities) : [],
  };
};

/** Validate the server proposal against the exact locally prepared AST. Root
 * editorial metadata may change for the release; legal text and Block IDs may
 * not. The publisher independently validates all bytes fetched from Git. */
export const assertPreparedLegislativeCandidate = (input: {
  publicationId: string;
  userId: string;
  manifestCanonical: string;
  identifiedAstCanonical: string;
  candidate: LegislativeCandidateArtifact;
}): void => {
  const manifest = parseCanonicalPublicationManifest(input.manifestCanonical);
  const ast = identifiedNormaAstSchema.parse(JSON.parse(input.identifiedAstCanonical) as unknown);
  if (
    serializeCanonicalJson(ast) !== input.identifiedAstCanonical ||
    manifest.publicationId !== input.publicationId ||
    manifest.approvedBy.userId !== input.userId ||
    manifest.law.lawId !== input.candidate.lawId ||
    manifest.expectedBase.publishedVersionId !== input.candidate.baseVersionId ||
    manifest.target.kind !== 'legislative_update' ||
    manifest.target.version !== ast.versaoVinculex ||
    manifest.artifacts.identifiedAstSha256 !== sha256(input.identifiedAstCanonical) ||
    calculateNormativeHash(ast, sha256) !== input.candidate.candidateNormativeSha256 ||
    serializeCanonicalJson(identities(ast)) !==
      serializeCanonicalJson(identities(input.candidate.ast))
  )
    throw new Error('UPDATE_CANDIDATE_MISMATCH');
  const declared = manifest.sourceSnapshots
    .map((source) =>
      [
        source.sourceArtifactSha256,
        source.sourceType,
        source.sourceRole,
        source.sourceVariant,
      ].join(':'),
    )
    .sort();
  const stored = input.candidate.snapshots
    .map((source) =>
      [
        source.sha256,
        source.referencia.sourceType,
        source.referencia.sourceRole,
        source.referencia.sourceVariant,
      ].join(':'),
    )
    .sort();
  if (serializeCanonicalJson(declared) !== serializeCanonicalJson(stored))
    throw new Error('UPDATE_CANDIDATE_MISMATCH');
};
