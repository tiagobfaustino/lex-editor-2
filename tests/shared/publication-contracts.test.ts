import { describe, expect, it } from 'vitest';

import {
  GetPublicationDiffCommandSchema,
  PreparePublicationCommandSchema,
  PrepareRollbackCommandSchema,
  PublicationAttemptDtoSchema,
  PublicationConfirmationDtoSchema,
} from '../../src/shared/ipc/publication.js';

const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const LAW_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

const attempt = {
  publicationId: PUBLICATION_ID,
  lawId: LAW_ID,
  version: '1.2.0',
  publicationNumber: 3,
  publicationKind: 'rollback' as const,
  publicationAttemptStatus: 'failed' as const,
  resumeFromStatus: 'syncing' as const,
  candidateSha: 'a'.repeat(40),
  manifestDigest: 'b'.repeat(64),
  publishedVersionId: null,
  updatedAt: '2026-08-10T15:00:00.000Z',
  retryable: true,
  message: 'Sincronização pendente; a mesma tentativa pode ser retomada.',
};

describe('publication desktop contracts', () => {
  it('keeps failed and intermediate attempts distinct from confirmed publication', () => {
    expect(PublicationAttemptDtoSchema.parse(attempt)).toEqual(attempt);
    expect(() =>
      PublicationAttemptDtoSchema.parse({
        ...attempt,
        publicationAttemptStatus: 'published',
        publishedVersionId: null,
        retryable: false,
      }),
    ).toThrow();
    expect(() =>
      PublicationAttemptDtoSchema.parse({
        ...attempt,
        publicationAttemptStatus: 'published',
        publishedVersionId: VERSION_ID,
        retryable: true,
      }),
    ).toThrow();
  });

  it('exposes only bounded summaries to the renderer', () => {
    const confirmation = PublicationConfirmationDtoSchema.parse({
      publicationId: PUBLICATION_ID,
      projectId: '44444444-4444-4444-8444-444444444444',
      lawId: LAW_ID,
      lawTitle: 'Lei de Demonstração',
      sigla: 'ldem',
      version: '1.2.0',
      publicationNumber: 3,
      publicationKind: 'rollback',
      publicationImpact: 'normative_projection',
      restoredVersionId: VERSION_ID,
      restoredVersion: '1.0.0',
      deviceCount: 1,
      artifactKinds: ['markdown', 'update_markdown', 'manifest', 'identified_ast'],
      sourceSummary: 'Rollback para versão histórica conferida.',
      changes: {
        included: 0,
        amended: 1,
        revoked: 0,
        renumbered: 0,
        items: [
          {
            changeKind: 'amended',
            blockId: 'ldem-art-1',
            destinationBlockId: null,
            description: 'Art. 1 alterado.',
          },
        ],
        truncated: false,
      },
      requiresLegalApproval: true,
    });

    expect(confirmation).not.toHaveProperty('manifestCanonical');
    expect(confirmation).not.toHaveProperty('ast');
    expect(confirmation).not.toHaveProperty('repositoryPath');
    expect(confirmation).not.toHaveProperty('accessToken');
    expect(() => PublicationConfirmationDtoSchema.parse({ ...confirmation, ast: {} })).toThrow();
  });

  it('rejects extra keys, multiline summaries and underspecified rollback commands', () => {
    expect(() =>
      PreparePublicationCommandSchema.parse({
        projectId: LAW_ID,
        sourceSummary: 'Resumo válido.',
        repositoryPath: '/tmp/repository',
      }),
    ).toThrow();
    expect(() =>
      PreparePublicationCommandSchema.parse({
        projectId: LAW_ID,
        sourceSummary: 'Linha um\nLinha dois',
      }),
    ).toThrow();
    expect(() =>
      PrepareRollbackCommandSchema.parse({
        projectId: LAW_ID,
        restoreVersionId: VERSION_ID,
        justification: 'curta',
      }),
    ).toThrow();
    expect(() =>
      GetPublicationDiffCommandSchema.parse({
        projectId: LAW_ID,
        fromVersionId: VERSION_ID,
        toVersionId: VERSION_ID,
        includeAst: true,
      }),
    ).toThrow();
  });
});
