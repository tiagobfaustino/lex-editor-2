import { describe, expect, it } from 'vitest';

import {
  buildMetadataChanges,
  createMetadataDraft,
  summarizeMetadataChanges,
  validateMetadataDraft,
} from '../../src/renderer/src/features/metadata/metadata-form-validation.js';
import type { MetadataStateDto } from '../../src/shared/ipc/metadata.js';

type FieldOrigin = MetadataStateDto['fields']['titulo']['origin'];
type FieldMutability = MetadataStateDto['fields']['titulo']['mutability'];
type BlockedReason = MetadataStateDto['fields']['titulo']['blockedReason'];

const field = <Value>(
  value: Value,
  options: Readonly<{
    origin?: FieldOrigin;
    mutability?: FieldMutability;
    editable?: boolean;
    blockedReason?: BlockedReason;
  }> = {},
) => ({
  value,
  origin: options.origin ?? ('editorial' as const),
  mutability: options.mutability ?? ('editable' as const),
  editable: options.editable ?? true,
  blockedReason: options.blockedReason ?? null,
});

const metadataState = (): MetadataStateDto => ({
  projectId: '00000000-0000-4000-8000-000000000012',
  revisionHash: 'a'.repeat(64),
  journalSequence: 4,
  publicationHistoryState: 'never_published',
  fields: {
    titulo: field('Lei de Teste'),
    sigla: field('ldt', { mutability: 'prepublication_only' }),
    tipoNorma: field('lei ordinária', { mutability: 'prepublication_only' }),
    numero: field('12', { mutability: 'prepublication_only' }),
    ano: field(2026, { mutability: 'prepublication_only' }),
    ramo: field('Direito público'),
    fonte: field('https://www.planalto.gov.br/teste', {
      origin: 'source_catalog',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'source_managed',
    }),
    dataPublicacao: field('2026-08-01', { origin: 'official_source' }),
    dataAtualizacaoLegal: field('2026-08-10', { origin: 'official_source' }),
    dataFormatacaoVinculex: field('2026-08-14', {
      origin: 'formatter',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'system_managed',
    }),
    totalArtigos: field(3, {
      origin: 'ast_structure',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'derived_value',
    }),
    versaoVinculex: field('1.0.0', {
      origin: 'publication',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'system_managed',
    }),
    legalStatus: field('vigente'),
    publicationStatus: field('draft', {
      origin: 'publication',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'system_managed',
    }),
    tags: field(['teste', 'federal']),
    revogadaPor: field(null),
    redacoesDadasPor: field(0, {
      origin: 'ast_structure',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'derived_value',
    }),
    idsDepreciados: field(0, {
      origin: 'reconciliation',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'derived_value',
    }),
    fontesSecundarias: field(0, {
      origin: 'source_catalog',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'source_managed',
    }),
    projectionProfile: field('complete_with_history', {
      origin: 'projection',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'system_managed',
    }),
    aliases: field(['Lei de Teste'], {
      origin: 'reference_catalog',
      mutability: 'read_only',
      editable: false,
      blockedReason: 'derived_value',
    }),
  },
});

describe('formulário de metadados', () => {
  it('produz diff mínimo normalizado apenas para campos editáveis', () => {
    const state = metadataState();
    state.fields.sigla.editable = false;
    state.fields.sigla.blockedReason = 'published_identity';
    const draft = {
      ...createMetadataDraft(state),
      titulo: '  Lei de Teste Atualizada  ',
      sigla: 'outra',
      tags: 'teste, federal, processo',
      reason: 'Correção após conferência oficial.',
    };

    const changes = buildMetadataChanges(draft, state);

    expect(changes).toEqual({
      titulo: 'Lei de Teste Atualizada',
      tags: ['teste', 'federal', 'processo'],
    });
    expect(summarizeMetadataChanges(changes, state)).toEqual([
      {
        field: 'titulo',
        label: 'Título',
        previous: 'Lei de Teste',
        next: 'Lei de Teste Atualizada',
      },
      {
        field: 'tags',
        label: 'Tags',
        previous: 'teste, federal',
        next: 'teste, federal, processo',
      },
    ]);
  });

  it('valida data real, ordem, sigla, tags, revogação e motivo antes do IPC', () => {
    const state = metadataState();
    const invalid = {
      ...createMetadataDraft(state),
      sigla: '12 inválida',
      ano: '999',
      dataPublicacao: '2026-02-30',
      dataAtualizacaoLegal: '2025-01-01',
      tags: 'duplicada, duplicada',
      legalStatus: 'revogada' as const,
      revogadaPor: '',
      reason: '',
    };

    const errors = validateMetadataDraft(invalid, state);
    expect(errors.sigla).toContain('começando por uma letra');
    expect(errors.ano).toContain('1000 e 9999');
    expect(errors.dataPublicacao).toContain('data de publicação real');
    expect(errors.tags).toContain('duplicadas');
    expect(errors.revogadaPor).toContain('obrigatório');
    expect(errors.reason).toContain('pelo menos 2');

    const reversedDates = {
      ...createMetadataDraft(state),
      dataAtualizacaoLegal: '2026-07-31',
      reason: 'Correção de data.',
    };
    expect(validateMetadataDraft(reversedDates, state).dataAtualizacaoLegal).toContain(
      'não pode anteceder',
    );
  });

  it('aceita uma alteração coerente antes de enviá-la ao IPC', () => {
    const state = metadataState();
    const draft = {
      ...createMetadataDraft(state),
      ramo: 'Direito administrativo',
      reason: 'Correção editorial.',
    };
    expect(validateMetadataDraft(draft, state)).toEqual({});
  });
});
