import { describe, expect, it } from 'vitest';

import {
  BatchExportResultDtoSchema,
  ChooseBatchExportDestinationCommandSchema,
  ChooseExportDestinationCommandSchema,
  ExportResultDtoSchema,
} from '../../src/shared/ipc/import.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DESTINATION_ID = '44444444-4444-4444-8444-444444444444';

describe('contratos de exportação em lote', () => {
  it('aceita apenas IDs opacos únicos e nunca caminhos do renderer', () => {
    expect(
      ChooseBatchExportDestinationCommandSchema.safeParse({ projectIds: [PROJECT_ID] }).success,
    ).toBe(true);
    expect(
      ChooseBatchExportDestinationCommandSchema.safeParse({
        projectIds: [PROJECT_ID, PROJECT_ID],
      }).success,
    ).toBe(false);
    expect(
      ChooseBatchExportDestinationCommandSchema.safeParse({
        projectIds: [PROJECT_ID],
        path: '/tmp/exportacao',
      }).success,
    ).toBe(false);
  });

  it('mantém resultado explícito e independente por lei sem revelar path', () => {
    const result = {
      destinationId: DESTINATION_ID,
      total: 2,
      succeeded: 1,
      failed: 1,
      results: [
        {
          projectId: PROJECT_ID,
          title: 'Código Penal',
          sigla: 'cp',
          batchExportStatus: 'succeeded',
          directoryName: 'codigo-penal',
          markdownFileName: 'cp.md',
          updateFileName: 'UPDATE.md',
          markdownSha256: 'a'.repeat(64),
          updateSha256: 'b'.repeat(64),
        },
        {
          projectId: '33333333-3333-4333-8333-333333333333',
          title: 'Lei inválida',
          sigla: 'li',
          batchExportStatus: 'failed',
          errorCode: 'NOT_APPROVED',
        },
      ],
    };
    expect(BatchExportResultDtoSchema.safeParse(result).success).toBe(true);
    expect(BatchExportResultDtoSchema.safeParse({ ...result, rootPath: '/tmp/leis' }).success).toBe(
      false,
    );
    expect(BatchExportResultDtoSchema.safeParse({ ...result, succeeded: 2 }).success).toBe(false);
  });
});

describe('contratos de exportação por projeção', () => {
  it('vincula um perfil explícito ao token opaco sem aceitar caminho', () => {
    expect(
      ChooseExportDestinationCommandSchema.safeParse({
        projectId: PROJECT_ID,
        projectionProfile: 'current_only',
      }).success,
    ).toBe(true);
    expect(
      ChooseExportDestinationCommandSchema.safeParse({
        projectId: PROJECT_ID,
        projectionProfile: 'current_only',
        path: '/tmp/lei.md',
      }).success,
    ).toBe(false);
  });

  it('identifica o perfil gravado sem revelar o destino real', () => {
    const result = {
      projectId: PROJECT_ID,
      destinationId: DESTINATION_ID,
      projectionProfile: 'current_only',
      fileName: 'lei-vigente.md',
      byteLength: 1_024,
      markdownSha256: 'a'.repeat(64),
    } as const;
    expect(ExportResultDtoSchema.safeParse(result).success).toBe(true);
    expect(ExportResultDtoSchema.safeParse({ ...result, path: '/tmp/lei.md' }).success).toBe(false);
    expect(
      ExportResultDtoSchema.safeParse({ ...result, projectionProfile: 'automatic' }).success,
    ).toBe(false);
  });
});
