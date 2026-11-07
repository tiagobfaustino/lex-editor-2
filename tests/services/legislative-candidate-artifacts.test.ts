import { createHash } from 'node:crypto';

import { calculateNormativeHash, identifiedMinima, origemMinima } from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

import {
  InMemoryLegislativeUpdateQueue,
  legislativeCandidateArtifactSchema,
} from '../../services/update-worker/src/index.js';

const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const payload = () => {
  const conteudo = '<html>ação legislativa íntegra</html>';
  const sha256 = hash(conteudo);
  return {
    schemaVersion: 1 as const,
    candidateArtifactId: '11111111-1111-4111-8111-111111111111',
    lawId: '22222222-2222-4222-8222-222222222222',
    baseVersionId: '33333333-3333-4333-8333-333333333333',
    baseNormativeSha256: 'a'.repeat(64),
    candidateNormativeSha256: calculateNormativeHash(identifiedMinima, hash),
    ast: structuredClone(identifiedMinima),
    snapshots: [
      {
        conteudo,
        sha256,
        referencia: { ...origemMinima, sourceArtifactSha256: sha256, fragmentSha256: sha256 },
      },
    ],
  };
};

describe('restricted legislative candidate artifacts', () => {
  it('verifies the normative digest and UTF8 snapshot bytes', () => {
    const artifact = payload();
    expect(legislativeCandidateArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(
      legislativeCandidateArtifactSchema.safeParse({
        ...artifact,
        candidateNormativeSha256: 'b'.repeat(64),
      }).success,
    ).toBe(false);
    const snapshot = artifact.snapshots[0];
    if (snapshot === undefined) throw new Error('Fixture sem snapshot.');
    snapshot.conteudo = 'forged raw source';
    expect(legislativeCandidateArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('makes a persisted artifact ID immutable and retries idempotent', async () => {
    const queue = new InMemoryLegislativeUpdateQueue(() => '44444444-4444-4444-8444-444444444444');
    const artifact = payload();
    await queue.saveCandidateArtifact(artifact);
    await queue.saveCandidateArtifact(structuredClone(artifact));
    const changed = payload();
    changed.ast.titulo = 'Outra revisão de metadados';
    expect(() => queue.saveCandidateArtifact(changed)).toThrow(
      'UPDATE_CANDIDATE_ARTIFACT_CONFLICT',
    );
    artifact.ast.titulo = 'Mutação do chamador';
    await queue.saveCandidateArtifact(payload());
  });
});
