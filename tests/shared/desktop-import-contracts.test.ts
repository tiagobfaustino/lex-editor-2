import { describe, expect, it } from 'vitest';

import {
  DESKTOP_IMPORT_LIMITS,
  ChooseExportDestinationCommandSchema,
  ContentProjectionProfileDtoSchema,
  DiagnosticPageDtoSchema,
  GetDiagnosticPageCommandSchema,
  LegalReferenceCommandSchema,
  LegalReferenceNavigationDtoSchema,
  LegalReferencePreviewDtoSchema,
  GetPreviewPageCommandSchema,
  ImportFromUrlCommandSchema,
  PreviewDocumentDtoSchema,
  PreviewPageDtoSchema,
  SetPreviewProjectionProfileCommandSchema,
  ProgressDtoSchema,
  SourceSummaryDtoSchema,
} from '../../src/shared/ipc/import.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID = '33333333-3333-4333-8333-333333333333';
const DIAGNOSTIC_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const SHA256 = 'a'.repeat(64);

const source = {
  sourceId: SOURCE_ID,
  sourceKind: 'local_html',
  displayName: 'codigo-penal.html',
  mediaType: 'text/html',
  byteLength: 1_024,
  sourceArtifactSha256: SHA256,
} as const;

const previewNode = {
  previewNodeId: NODE_ID,
  parentPreviewNodeId: null,
  nodeKind: 'artigo',
  depth: 0,
  order: 0,
  label: 'Art. 1º',
  plainText: '<script>window.electronAPI</script>',
  blockId: 'cp-art-1',
  deviceStatus: 'active',
  hasChildren: false,
  childCount: 0,
  histories: [],
  legalReferences: [],
  sourceRange: null,
} as const;

describe('contratos de comando da importação desktop', () => {
  it('aceita somente URL HTTP(S), sem credenciais e dentro do limite', () => {
    expect(
      ImportFromUrlCommandSchema.safeParse({
        url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm',
      }).success,
    ).toBe(true);

    for (const url of [
      'file:///etc/passwd',
      'https://usuario:segredo@www.planalto.gov.br/lei.htm',
      `https://www.planalto.gov.br/${'x'.repeat(DESKTOP_IMPORT_LIMITS.maxUrlCharacters)}`,
    ]) {
      expect(ImportFromUrlCommandSchema.safeParse({ url }).success).toBe(false);
    }
  });

  it('aceita somente os dois perfis de projeção e nunca recebe AST ou path', () => {
    expect(ContentProjectionProfileDtoSchema.safeParse('complete_with_history').success).toBe(true);
    expect(ContentProjectionProfileDtoSchema.safeParse('current_only').success).toBe(true);
    expect(ContentProjectionProfileDtoSchema.safeParse('infer_current').success).toBe(false);

    expect(
      SetPreviewProjectionProfileCommandSchema.safeParse({
        projectId: PROJECT_ID,
        projectionProfile: 'current_only',
      }).success,
    ).toBe(true);
    expect(
      SetPreviewProjectionProfileCommandSchema.safeParse({
        projectId: PROJECT_ID,
        projectionProfile: 'current_only',
        ast: { children: [] },
      }).success,
    ).toBe(false);
    expect(
      ChooseExportDestinationCommandSchema.safeParse({
        projectId: PROJECT_ID,
        projectionProfile: 'complete_with_history',
        path: '/tmp/lei.md',
      }).success,
    ).toBe(false);
  });

  it('fecha objetos e aplica defaults e máximos das páginas', () => {
    expect(
      GetPreviewPageCommandSchema.parse({
        projectId: PROJECT_ID,
        parentPreviewNodeId: null,
        cursor: null,
      }),
    ).toMatchObject({ limit: DESKTOP_IMPORT_LIMITS.previewPageDefaultItems });

    expect(
      GetPreviewPageCommandSchema.safeParse({
        projectId: PROJECT_ID,
        parentPreviewNodeId: null,
        cursor: null,
        limit: DESKTOP_IMPORT_LIMITS.previewPageMaxItems + 1,
      }).success,
    ).toBe(false);
    expect(
      GetDiagnosticPageCommandSchema.safeParse({
        projectId: PROJECT_ID,
        cursor: null,
        debugPath: '/tmp/fonte.html',
      }).success,
    ).toBe(false);
  });
});

describe('DTO de progresso', () => {
  it('usa ciclo de vida qualificado e mantém contadores coerentes', () => {
    const valid = {
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      sequence: 3,
      jobStatus: 'running',
      phase: 'parsing',
      completedUnits: 40,
      totalUnits: 100,
      message: '40 dispositivos reconhecidos',
    } as const;

    expect(ProgressDtoSchema.safeParse(valid).success).toBe(true);
    expect(ProgressDtoSchema.safeParse({ ...valid, completedUnits: 101 }).success).toBe(false);
    expect(ProgressDtoSchema.safeParse({ ...valid, status: 'running' }).success).toBe(false);
  });
});

describe('projeções paginadas e sanitizadas', () => {
  it('limita referências jurídicas a IDs opacos e texto plano', () => {
    const referenceId = 'b'.repeat(64);
    expect(
      LegalReferenceCommandSchema.safeParse({ projectId: PROJECT_ID, referenceId }).success,
    ).toBe(true);
    expect(
      LegalReferenceCommandSchema.safeParse({
        projectId: PROJECT_ID,
        referenceId,
        path: '/home/editor/VincuLex/cf88.md',
      }).success,
    ).toBe(false);
    expect(
      LegalReferencePreviewDtoSchema.safeParse({
        referenceId,
        targetTitle: 'Constituição Federal de 1988',
        targetSigla: 'cf88',
        targetLegalPath: 'Art. 37',
        targetDeviceStatus: 'active',
        targetPlainText: 'A administração pública obedecerá aos princípios legais.',
        external: true,
      }).success,
    ).toBe(true);
    expect(
      LegalReferencePreviewDtoSchema.safeParse({
        referenceId,
        targetTitle: 'CF',
        targetSigla: 'cf88',
        targetLegalPath: 'Art. 37',
        targetDeviceStatus: 'active',
        targetPlainText: 'Texto',
        external: true,
        html: '<strong>Texto</strong>',
      }).success,
    ).toBe(false);
    expect(
      LegalReferenceNavigationDtoSchema.safeParse({
        targetProjectId: PROJECT_ID,
        targetPreviewNodeId: NODE_ID,
        external: true,
      }).success,
    ).toBe(true);
  });

  it('expõe resumo seguro da fonte sem path, HTML ou AST', () => {
    expect(SourceSummaryDtoSchema.safeParse(source).success).toBe(true);

    for (const forbidden of [
      { path: '/home/editor/codigo-penal.html' },
      { rawHtml: '<script>alert(1)</script>' },
      { ast: { tipo: 'lei' } },
    ]) {
      expect(SourceSummaryDtoSchema.safeParse({ ...source, ...forbidden }).success).toBe(false);
    }
  });

  it('transporta conteúdo somente como texto plano e limita a página', () => {
    expect(
      PreviewPageDtoSchema.safeParse({
        items: [previewNode],
        nextCursor: null,
        totalItems: 1,
      }).success,
    ).toBe(true);
    expect(
      PreviewPageDtoSchema.safeParse({
        items: Array.from(
          { length: DESKTOP_IMPORT_LIMITS.previewPageMaxItems + 1 },
          () => previewNode,
        ),
        nextCursor: null,
        totalItems: DESKTOP_IMPORT_LIMITS.previewPageMaxItems + 1,
      }).success,
    ).toBe(false);
    expect(
      PreviewPageDtoSchema.safeParse({
        items: [{ ...previewNode, html: '<strong>Art. 1º</strong>' }],
        nextCursor: null,
        totalItems: 1,
      }).success,
    ).toBe(false);
    expect(
      PreviewPageDtoSchema.safeParse({
        items: [{ ...previewNode, childCount: 1, hasChildren: false }],
        nextCursor: null,
        totalItems: 1,
      }).success,
    ).toBe(false);
  });

  it('limita metadados, callouts e diagnósticos sem payload interno', () => {
    expect(
      PreviewDocumentDtoSchema.safeParse({
        projectId: PROJECT_ID,
        revisionHash: 'c'.repeat(64),
        projectionProfile: 'complete_with_history',
        source,
        title: 'Código Penal',
        sigla: 'cp',
        legalStatus: 'vigente',
        totalArticles: 434,
        totalPreviewNodes: 1_684,
        metadata: [{ key: 'title', value: 'Código Penal' }],
        callouts: [
          {
            calloutKind: 'info',
            title: 'Fonte oficial',
            plainText: 'Texto compilado pelo Planalto.',
          },
        ],
      }).success,
    ).toBe(true);

    const diagnostic = {
      diagnosticId: DIAGNOSTIC_ID,
      severity: 'warning',
      code: 'revisao_recomendada',
      message: 'Confira o dispositivo na fonte oficial.',
      blocksExport: false,
      previewNodeId: NODE_ID,
      blockId: 'cp-art-1',
      sourceRange: null,
    } as const;

    expect(
      DiagnosticPageDtoSchema.safeParse({
        items: [diagnostic],
        nextCursor: 'pagina_2',
        totalItems: 2,
      }).success,
    ).toBe(true);
    expect(
      DiagnosticPageDtoSchema.safeParse({
        items: [{ ...diagnostic, stack: 'segredo interno' }],
        nextCursor: null,
        totalItems: 1,
      }).success,
    ).toBe(false);
  });
});
