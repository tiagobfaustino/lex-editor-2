import { createHash } from 'node:crypto';

import {
  calculateNormativeHash,
  identifiedNormaAstSchema,
  montarConjuntoDeFontes,
  sourceReferenceSchema,
} from '@lex-editor/legal-domain';
import { z } from 'zod';

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Restricted worker/main payload. It never becomes a renderer DTO. */
export const legislativeCandidateArtifactSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    candidateArtifactId: z.uuid(),
    lawId: z.uuid(),
    baseVersionId: z.uuid(),
    baseNormativeSha256: digestSchema,
    candidateNormativeSha256: digestSchema,
    ast: identifiedNormaAstSchema,
    snapshots: z
      .array(
        z.strictObject({
          sha256: digestSchema,
          conteudo: z
            .string()
            .min(1)
            .max(20 * 1024 * 1024),
          referencia: sourceReferenceSchema,
        }),
      )
      .min(1)
      .max(10),
  })
  .superRefine((artifact, context) => {
    if (calculateNormativeHash(artifact.ast, sha256) !== artifact.candidateNormativeSha256) {
      context.addIssue({
        code: 'custom',
        path: ['candidateNormativeSha256'],
        message: 'UPDATE_CANDIDATE_HASH_MISMATCH',
      });
    }
    if (!montarConjuntoDeFontes(artifact.snapshots).ok) {
      context.addIssue({
        code: 'custom',
        path: ['snapshots'],
        message: 'UPDATE_CANDIDATE_SOURCES_INVALID',
      });
    }
    const digests = new Set<string>();
    for (const [index, snapshot] of artifact.snapshots.entries()) {
      if (
        Buffer.byteLength(snapshot.conteudo, 'utf8') > 20 * 1024 * 1024 ||
        sha256(snapshot.conteudo) !== snapshot.sha256 ||
        digests.has(snapshot.sha256)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['snapshots', index],
          message: 'UPDATE_CANDIDATE_SNAPSHOT_INVALID',
        });
      }
      digests.add(snapshot.sha256);
    }
  });

export type LegislativeCandidateArtifact = z.infer<typeof legislativeCandidateArtifactSchema>;
