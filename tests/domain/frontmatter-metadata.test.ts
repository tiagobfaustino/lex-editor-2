import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  applyEditorialCommand,
  calculateRevisionHash,
  editableLawMetadataChangesSchema,
  editorialCommandSchema,
  formatar,
  frontmatterMetadataProjectionSchema,
  identifiedMinima,
  lawMetadataCommandChangesSchema,
  legalNormIdentityKey,
  projectFrontmatterMetadata,
  publicationHistoryEvidenceSchema,
  replayEditorialJournal,
  validateLawMetadataChangesPolicy,
  type EditorialCommand,
  type EditorialJournal,
  type IdentifiedNormaAST,
  type PublicationHistoryState,
} from '@lex-editor/legal-domain';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type MetadataCommandChanges = Extract<
  EditorialCommand['operation'],
  { kind: 'set_law_metadata' }
>['changes'];

const command = (
  ast: IdentifiedNormaAST,
  changes: MetadataCommandChanges,
  reason = 'Conferência dos metadados na fonte oficial.',
): EditorialCommand => ({
  schemaVersion: 1,
  commandId: '11111111-1111-4111-8111-111111111111',
  localActorId: 'editor-local-01',
  occurredAt: '2026-08-14T12:00:00.000-03:00',
  expectedRevisionHash: calculateRevisionHash(ast, sha256),
  operation: { kind: 'set_law_metadata', changes, reason },
});

const applyMetadata = (
  ast: IdentifiedNormaAST,
  changes: Parameters<typeof command>[1],
  publicationHistoryState: PublicationHistoryState = 'unknown',
) =>
  applyEditorialCommand(ast, command(ast, changes), sha256, {
    publicationHistoryEvidence: publicationHistoryEvidenceSchema.parse({
      schemaVersion: 1,
      canonicalIdentityKey: legalNormIdentityKey({
        tipoNorma: ast.tipoNorma,
        numero: ast.numero,
        ano: ast.ano,
      }),
      state: publicationHistoryState,
      authorityRevision:
        publicationHistoryState === 'unknown' ? null : 'publication-authority-revision-1',
    }),
  });

describe('projeção tipada dos metadados de frontmatter', () => {
  it.each([
    ['never_published', true, null],
    ['published', false, 'published_identity'],
    ['unknown', false, 'publication_history_unknown'],
  ] as const)(
    'projeta identidade no estado %s com a política contextual correta',
    (publicationHistoryState, editable, blockedReason) => {
      const projection = projectFrontmatterMetadata(identifiedMinima, {
        publicationHistoryState,
        projectionProfile: 'current_only',
        aliases: ['Lei demonstrativa'],
      });

      expect(frontmatterMetadataProjectionSchema.parse(projection)).toEqual(projection);
      expect(projection.fields.sigla).toMatchObject({
        value: identifiedMinima.sigla,
        origin: 'import',
        mutability: 'prepublication_only',
        editable,
        blockedReason,
      });
      expect(projection.fields.projectionProfile.value).toBe('current_only');
      expect(projection.fields.aliases.value).toEqual(['Lei demonstrativa']);
    },
  );

  it('cobre os 13 campos obrigatórios e os opcionais/derivados suportados', () => {
    const projection = projectFrontmatterMetadata(identifiedMinima, {
      publicationHistoryState: 'never_published',
    });
    const fields = projection.fields;

    expect(Object.keys(fields)).toEqual([
      'titulo',
      'sigla',
      'tipoNorma',
      'numero',
      'ano',
      'ramo',
      'fonte',
      'dataPublicacao',
      'dataAtualizacaoLegal',
      'dataFormatacaoVinculex',
      'totalArtigos',
      'versaoVinculex',
      'legalStatus',
      'publicationStatus',
      'tags',
      'revogadaPor',
      'redacoesDadasPor',
      'idsDepreciados',
      'fontesSecundarias',
      'projectionProfile',
      'aliases',
    ]);
    expect(
      Object.fromEntries(
        Object.entries(fields).map(([name, projected]) => [
          name,
          {
            origin: projected.origin,
            mutability: projected.mutability,
            editable: projected.editable,
            blockedReason: projected.blockedReason,
          },
        ]),
      ),
    ).toEqual({
      titulo: { origin: 'import', mutability: 'editable', editable: true, blockedReason: null },
      sigla: {
        origin: 'import',
        mutability: 'prepublication_only',
        editable: true,
        blockedReason: null,
      },
      tipoNorma: {
        origin: 'import',
        mutability: 'prepublication_only',
        editable: true,
        blockedReason: null,
      },
      numero: {
        origin: 'official_source',
        mutability: 'prepublication_only',
        editable: true,
        blockedReason: null,
      },
      ano: {
        origin: 'official_source',
        mutability: 'prepublication_only',
        editable: true,
        blockedReason: null,
      },
      ramo: { origin: 'editorial', mutability: 'editable', editable: true, blockedReason: null },
      fonte: {
        origin: 'source_catalog',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'source_managed',
      },
      dataPublicacao: {
        origin: 'official_source',
        mutability: 'editable',
        editable: true,
        blockedReason: null,
      },
      dataAtualizacaoLegal: {
        origin: 'official_source',
        mutability: 'editable',
        editable: true,
        blockedReason: null,
      },
      dataFormatacaoVinculex: {
        origin: 'formatter',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'system_managed',
      },
      totalArtigos: {
        origin: 'ast_structure',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'system_managed',
      },
      versaoVinculex: {
        origin: 'publication',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'system_managed',
      },
      legalStatus: {
        origin: 'editorial',
        mutability: 'editable',
        editable: true,
        blockedReason: null,
      },
      publicationStatus: {
        origin: 'publication',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'system_managed',
      },
      tags: { origin: 'editorial', mutability: 'editable', editable: true, blockedReason: null },
      revogadaPor: {
        origin: 'editorial',
        mutability: 'editable',
        editable: true,
        blockedReason: null,
      },
      redacoesDadasPor: {
        origin: 'ast_structure',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'system_managed',
      },
      idsDepreciados: {
        origin: 'reconciliation',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'derived_value',
      },
      fontesSecundarias: {
        origin: 'source_catalog',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'source_managed',
      },
      projectionProfile: {
        origin: 'projection',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'derived_value',
      },
      aliases: {
        origin: 'reference_catalog',
        mutability: 'read_only',
        editable: false,
        blockedReason: 'derived_value',
      },
    });
  });
});

describe('schemas e regras completas dos metadados', () => {
  it('recusa alteração vazia, payload extra e valores fora do contrato', () => {
    expect(editableLawMetadataChangesSchema.safeParse({}).success).toBe(false);
    expect(
      editableLawMetadataChangesSchema.safeParse({ titulo: 'Título', chaveArbitraria: true })
        .success,
    ).toBe(false);
    expect(
      lawMetadataCommandChangesSchema.safeParse({ dataPublicacao: '2026-02-30' }).success,
    ).toBe(false);
    expect(lawMetadataCommandChangesSchema.safeParse({ legalStatus: 'expirada' }).success).toBe(
      false,
    );
    expect(lawMetadataCommandChangesSchema.safeParse({ fonte: 'não-é-url' }).success).toBe(false);
    expect(lawMetadataCommandChangesSchema.safeParse({ ano: 99 }).success).toBe(false);
    expect(lawMetadataCommandChangesSchema.safeParse({ sigla: 'CF 88' }).success).toBe(false);
    expect(lawMetadataCommandChangesSchema.safeParse({ tags: ['penal', 'penal'] }).success).toBe(
      false,
    );
  });

  it('valida regras cruzadas sobre o estado final, não apenas sobre o patch', () => {
    const dateConflict = applyMetadata(identifiedMinima, {
      dataPublicacao: '2026-04-01',
    });
    const legalStatusConflict = applyMetadata(identifiedMinima, {
      revogadaPor: 'Lei nº 99/2026',
    });

    expect(dateConflict).toMatchObject({
      ok: false,
      error: { code: 'metadata_cross_field_invalid' },
    });
    expect(legalStatusConflict).toMatchObject({
      ok: false,
      error: { code: 'metadata_cross_field_invalid' },
    });
  });

  it('revalida URLs sistêmicas ao projetar uma IdentifiedNormaAST', () => {
    const invalidSource = { ...clone(identifiedMinima), fonte: 'arquivo arbitrário' };

    expect(() =>
      projectFrontmatterMetadata(invalidSource, { publicationHistoryState: 'unknown' }),
    ).toThrow();
  });
});

describe('política contextual de set_law_metadata', () => {
  it('aceita correção editorial comum e mantém AST/Formatter equivalentes', () => {
    const original = clone(identifiedMinima);
    const result = applyMetadata(original, {
      titulo: 'Lei demonstrativa revisada',
      ramo: 'direito público',
      tags: ['estudo', 'legislação'],
    });

    expect(result.ok).toBe(true);
    expect(original).toEqual(identifiedMinima);
    if (!result.ok) throw new Error('A correção editorial deveria ser válida.');
    const markdown = formatar(result.ast);
    expect(markdown.ok).toBe(true);
    expect(markdown.ok ? markdown.valor : '').toContain('title: "Lei demonstrativa revisada"');
    expect(markdown.ok ? markdown.valor : '').toContain('tags: ["estudo", "legislação"]');
  });

  it.each([
    ['fonte', 'https://example.com/lei'],
    ['dataFormatacaoVinculex', '2026-08-15'],
    ['totalArtigos', 99],
    ['versaoVinculex', '2.0.0'],
    ['publicationStatus', 'published'],
    ['redacoesDadasPor', []],
    ['idsDepreciados', []],
    ['fontesSecundarias', ['https://example.com/auxiliar']],
    ['projectionProfile', 'current_only'],
    ['aliases', ['Alias indevido']],
  ] as const)('rejeita o campo controlado %s por chamada direta', (field, value) => {
    const original = clone(identifiedMinima);
    const result = applyMetadata(original, { [field]: value });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'metadata_field_not_editable' },
    });
    expect(original).toEqual(identifiedMinima);
  });

  it('falha fechada para identidade publicada ou sem histórico comprovável', () => {
    const published = applyMetadata(identifiedMinima, { sigla: 'ldem2' }, 'published');
    const unknown = applyMetadata(identifiedMinima, { numero: '2' }, 'unknown');
    const neverPublishedPolicy = validateLawMetadataChangesPolicy(
      identifiedMinima,
      { sigla: 'ldem2' },
      'never_published',
    );

    expect(published).toMatchObject({
      ok: false,
      error: { code: 'published_identity_immutable' },
    });
    expect(unknown).toMatchObject({
      ok: false,
      error: { code: 'publication_history_required' },
    });
    expect(neverPublishedPolicy).toMatchObject({ ok: true, changesIdentity: true });
  });

  it('exige motivo no contrato do comando de metadados', () => {
    const raw = command(identifiedMinima, { legalStatus: 'alterada' }) as unknown as {
      operation: Record<string, unknown>;
    };
    raw.operation['reason'] = '  ';

    expect(editorialCommandSchema.safeParse(raw).success).toBe(false);
  });

  it('rejeita replay adulterado que tenta gravar campo somente leitura', () => {
    const base = clone(identifiedMinima);
    const baseRevisionHash = calculateRevisionHash(base, sha256);
    const forbidden = command(base, { fonte: 'https://example.com/lei' });
    const journal: EditorialJournal = {
      schemaVersion: 1,
      journalId: '22222222-2222-4222-8222-222222222222',
      projectId: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-08-14T12:00:00.000-03:00',
      base: { revisionHash: baseRevisionHash, ast: base },
      entries: [
        {
          sequence: 1,
          command: forbidden,
          resultRevisionHash: 'f'.repeat(64),
        },
      ],
    };

    expect(replayEditorialJournal(journal, sha256)).toMatchObject({
      ok: false,
      error: {
        code: 'command_rejected',
        sequence: 1,
        commandErrorCode: 'metadata_field_not_editable',
      },
    });
  });
});
