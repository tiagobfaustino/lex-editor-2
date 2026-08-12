import { describe, expect, it } from 'vitest';

import {
  CorrectEditorialTextCommandSchema,
  EditorialStateDtoSchema,
} from '../../src/shared/ipc/editorial.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const PREVIEW_NODE_ID = '33333333-3333-4333-8333-333333333333';

describe('contratos IPC editoriais', () => {
  it('aceita somente intenção de correção por IDs opacos e campos limitados', () => {
    expect(
      CorrectEditorialTextCommandSchema.safeParse({
        projectId: PROJECT_ID,
        previewNodeId: PREVIEW_NODE_ID,
        value: 'Texto conferido.',
        reason: 'Conferência com o snapshot oficial.',
      }).success,
    ).toBe(true);
    expect(
      CorrectEditorialTextCommandSchema.safeParse({
        projectId: PROJECT_ID,
        previewNodeId: PREVIEW_NODE_ID,
        value: 'Texto conferido.',
        reason: 'Conferência com o snapshot oficial.',
        path: '/home/editor/projeto.json',
      }).success,
    ).toBe(false);
    expect(
      CorrectEditorialTextCommandSchema.safeParse({
        projectId: PROJECT_ID,
        previewNodeId: PREVIEW_NODE_ID,
        value: 'Texto conferido.',
        reason: ' ',
      }).success,
    ).toBe(false);
  });

  it('projeta somente resumo editorial e recusa AST ou caminho real na saída', () => {
    const state = {
      projectId: PROJECT_ID,
      revisionHash: 'a'.repeat(64),
      journalSequence: 2,
      saveState: 'saved',
      validatedAt: '2026-08-10T13:00:00.000-03:00',
      validationMode: 'full',
      validationIsComplete: true,
      blockingCount: 0,
      warningCount: 1,
      unconfirmedWarningCount: 0,
      reviewApprovalStatus: 'approved',
      canApprove: false,
      canExport: true,
      diagnostics: [],
      reviewTargets: [],
    };

    expect(EditorialStateDtoSchema.safeParse(state).success).toBe(true);
    expect(EditorialStateDtoSchema.safeParse({ ...state, ast: { tipo: 'lei' } }).success).toBe(
      false,
    );
    expect(
      EditorialStateDtoSchema.safeParse({ ...state, journalPath: '/tmp/diario.json' }).success,
    ).toBe(false);
  });
});
