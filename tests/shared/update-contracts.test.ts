import { describe, expect, it } from 'vitest';

import {
  LegislativeUpdateDetailDtoSchema,
  RejectLegislativeUpdateCommandSchema,
} from '../../src/shared/ipc/updates.js';

const UPDATE_ID = '10000000-0000-4000-8000-000000000001';
const LAW_ID = '10000000-0000-4000-8000-000000000002';
const VERSION_ID = '10000000-0000-4000-8000-000000000003';

const detail = {
  updateId: UPDATE_ID,
  lawId: LAW_ID,
  lawSigla: 'l9099',
  lawTitle: 'Lei dos Juizados Especiais',
  sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l9099.htm',
  updateReviewStatus: 'pending' as const,
  summary: {
    unchanged: 0,
    amended: 1,
    included: 0,
    revoked: 0,
    renumbered: 0,
    missingPublished: 0,
  },
  overallConfidence: 'high' as const,
  requiresHumanReview: false,
  detectedAt: '2026-08-11T15:00:00.000Z',
  lastDetectedAt: '2026-08-11T15:00:00.000Z',
  detectionCount: 1,
  retryCount: 0,
  rejectionReason: null,
  errorCode: null,
  publicationId: null,
  reprocessRequested: false,
  baseVersionId: VERSION_ID,
  entries: [
    {
      category: 'amended' as const,
      affectedBlockId: 'l9099-art-61',
      before: {
        blockId: 'l9099-art-61',
        path: ['Art. 61'],
        text: 'Texto publicado.',
        deviceStatus: 'active' as const,
      },
      after: {
        blockId: 'l9099-art-61',
        path: ['Art. 61'],
        text: 'Texto candidato.',
        deviceStatus: 'amended' as const,
      },
      confidence: 'high' as const,
      confidenceReasons: ['exact_legal_designator'],
      requiresHumanReview: false,
      renumberingEvidence: null,
    },
  ],
  missingPublishedBlockIds: [],
  truncated: false,
};

describe('contratos IPC de atualização legislativa', () => {
  it('expõe apenas diff sanitizado, sem AST, artefato bruto ou caminho', () => {
    const parsed = LegislativeUpdateDetailDtoSchema.parse(detail);
    expect(parsed.entries[0]?.before?.text).toBe('Texto publicado.');
    expect(parsed).not.toHaveProperty('candidateAst');
    expect(parsed).not.toHaveProperty('candidateArtifactId');
    expect(parsed).not.toHaveProperty('sourceArtifacts');
    expect(() =>
      LegislativeUpdateDetailDtoSchema.parse({ ...detail, candidatePath: '/tmp/candidate.json' }),
    ).toThrow();
  });

  it('exige motivo substancial, em uma linha, para rejeitar', () => {
    expect(() =>
      RejectLegislativeUpdateCommandSchema.parse({ updateId: UPDATE_ID, reason: 'curto' }),
    ).toThrow();
    expect(() =>
      RejectLegislativeUpdateCommandSchema.parse({
        updateId: UPDATE_ID,
        reason: 'Primeira linha\nsegunda linha',
      }),
    ).toThrow();
  });
});
