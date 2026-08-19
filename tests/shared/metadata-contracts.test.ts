import { describe, expect, it } from 'vitest';

import {
  GetMetadataStateCommandSchema,
  MetadataStateDtoSchema,
  UpdateMetadataCommandSchema,
} from '../../src/shared/ipc/metadata.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REVISION_HASH = 'a'.repeat(64);

describe('metadata desktop contracts', () => {
  it('aceita somente diff fechado, revisão esperada e motivo limitado', () => {
    expect(
      UpdateMetadataCommandSchema.parse({
        projectId: PROJECT_ID,
        expectedRevisionHash: REVISION_HASH,
        changes: { titulo: 'Lei revisada', tags: ['legislação'] },
        reason: 'Conferência na fonte oficial.',
      }),
    ).toMatchObject({ changes: { titulo: 'Lei revisada' } });

    expect(
      UpdateMetadataCommandSchema.safeParse({
        projectId: PROJECT_ID,
        expectedRevisionHash: REVISION_HASH,
        changes: { fonte: 'https://example.com/forjada' },
        reason: 'Tentativa direta.',
      }).success,
    ).toBe(false);
    expect(
      UpdateMetadataCommandSchema.safeParse({
        projectId: PROJECT_ID,
        expectedRevisionHash: REVISION_HASH,
        changes: { titulo: 'Lei revisada' },
        reason: 'Motivo válido.',
        localActorId: 'ator-forjado',
        occurredAt: '2026-08-14T12:00:00.000Z',
        publicationHistoryState: 'never_published',
      }).success,
    ).toBe(false);
  });

  it('rejeita payload extra de leitura e resposta com AST ou caminho', () => {
    expect(
      GetMetadataStateCommandSchema.safeParse({ projectId: PROJECT_ID, path: '/tmp/lei.md' })
        .success,
    ).toBe(false);

    const minimalInvalidResponse = {
      projectId: PROJECT_ID,
      revisionHash: REVISION_HASH,
      journalSequence: 1,
      publicationHistoryState: 'unknown',
      fields: {},
      ast: { astPhase: 'identified' },
      repositoryPath: '/tmp/segredo',
    };
    expect(MetadataStateDtoSchema.safeParse(minimalInvalidResponse).success).toBe(false);
  });

  it('limita tags, datas reais e tamanho do formulário', () => {
    expect(
      UpdateMetadataCommandSchema.safeParse({
        projectId: PROJECT_ID,
        expectedRevisionHash: REVISION_HASH,
        changes: { dataPublicacao: '2026-02-30' },
        reason: 'Conferência na fonte.',
      }).success,
    ).toBe(false);
    expect(
      UpdateMetadataCommandSchema.safeParse({
        projectId: PROJECT_ID,
        expectedRevisionHash: REVISION_HASH,
        changes: { tags: Array.from({ length: 101 }, (_, index) => `tag-${String(index)}`) },
        reason: 'Conferência na fonte.',
      }).success,
    ).toBe(false);
  });
});
