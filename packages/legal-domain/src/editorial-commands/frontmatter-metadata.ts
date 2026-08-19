import { z } from 'zod';

import { contentProjectionProfileSchema } from '../content-projection/index.js';
import {
  lawAcronymSchema,
  lawBranchSchema,
  lawLegalStatusSchema,
  lawNumberSchema,
  lawTagsSchema,
  lawTitleSchema,
  lawTypeSchema,
  lawYearSchema,
  metadataDateSchema,
  metadataFieldSchemas,
  revokingLawSchema,
  secondarySourcesSchema,
  sourceUrlSchema,
  vinculexSemverSchema,
} from '../ast/metadata-fields.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import {
  blockIdDepreciadoSchema,
  identifiedNormaAstSchema,
  referenciaRedacaoSchema,
} from '../ast/schemas.js';

export const publicationHistoryStateSchema = z.enum(['never_published', 'published', 'unknown']);
export const metadataMutabilitySchema = z.enum(['editable', 'prepublication_only', 'read_only']);
export const metadataOriginSchema = z.enum([
  'import',
  'official_source',
  'editorial',
  'source_catalog',
  'formatter',
  'ast_structure',
  'publication',
  'projection',
  'reference_catalog',
  'reconciliation',
]);
export const metadataBlockedReasonSchema = z.enum([
  'published_identity',
  'publication_history_unknown',
  'source_managed',
  'system_managed',
  'derived_value',
]);

export const editableLawMetadataChangesSchema = z
  .strictObject({
    titulo: lawTitleSchema.optional(),
    sigla: lawAcronymSchema.optional(),
    tipoNorma: lawTypeSchema.optional(),
    numero: lawNumberSchema.optional(),
    ano: lawYearSchema.optional(),
    ramo: lawBranchSchema.optional(),
    dataPublicacao: metadataDateSchema.optional(),
    dataAtualizacaoLegal: metadataDateSchema.optional(),
    legalStatus: lawLegalStatusSchema.optional(),
    tags: lawTagsSchema.optional(),
    revogadaPor: revokingLawSchema.optional(),
  })
  .check((ctx) => {
    if (Object.keys(ctx.value).length === 0) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: 'A correção de metadados precisa alterar ao menos um campo.',
      });
    }
  });

/**
 * Contrato persistível do comando. Ele enumera também campos conhecidos mas
 * não editáveis para que a política os rejeite com código estável durante uma
 * chamada direta ou replay, sem aceitar um patch chave/valor arbitrário.
 */
export const lawMetadataCommandChangesSchema = z
  .strictObject({
    titulo: lawTitleSchema.optional(),
    sigla: lawAcronymSchema.optional(),
    tipoNorma: lawTypeSchema.optional(),
    numero: lawNumberSchema.optional(),
    ano: lawYearSchema.optional(),
    ramo: lawBranchSchema.optional(),
    fonte: sourceUrlSchema.optional(),
    dataPublicacao: metadataDateSchema.optional(),
    dataAtualizacaoLegal: metadataDateSchema.optional(),
    dataFormatacaoVinculex: metadataDateSchema.optional(),
    totalArtigos: metadataFieldSchemas.totalArtigos.optional(),
    versaoVinculex: vinculexSemverSchema.optional(),
    legalStatus: lawLegalStatusSchema.optional(),
    publicationStatus: metadataFieldSchemas.publicationStatus.optional(),
    tags: lawTagsSchema.optional(),
    revogadaPor: revokingLawSchema.optional(),
    redacoesDadasPor: z.array(referenciaRedacaoSchema).optional(),
    idsDepreciados: z.array(blockIdDepreciadoSchema).optional(),
    fontesSecundarias: secondarySourcesSchema.optional(),
    projectionProfile: contentProjectionProfileSchema.optional(),
    aliases: z.array(z.string().min(1).max(500)).max(500).optional(),
  })
  .check((ctx) => {
    if (Object.keys(ctx.value).length === 0) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: 'A correção de metadados precisa alterar ao menos um campo.',
      });
    }
  });

export const frontmatterMetadataContextSchema = z.strictObject({
  publicationHistoryState: publicationHistoryStateSchema,
  projectionProfile: contentProjectionProfileSchema.default('complete_with_history'),
  aliases: z.array(z.string().min(1).max(500)).max(500).default([]),
});

const projectedFieldSchema = <Schema extends z.ZodType>(
  valueSchema: Schema,
  origin: z.infer<typeof metadataOriginSchema>,
  mutability: z.infer<typeof metadataMutabilitySchema>,
) =>
  z.strictObject({
    value: valueSchema,
    origin: z.literal(origin),
    mutability: z.literal(mutability),
    editable: z.boolean(),
    blockedReason: metadataBlockedReasonSchema.nullable(),
  });

export const frontmatterMetadataProjectionSchema = z.strictObject({
  publicationHistoryState: publicationHistoryStateSchema,
  fields: z.strictObject({
    titulo: projectedFieldSchema(lawTitleSchema, 'import', 'editable'),
    sigla: projectedFieldSchema(lawAcronymSchema, 'import', 'prepublication_only'),
    tipoNorma: projectedFieldSchema(lawTypeSchema, 'import', 'prepublication_only'),
    numero: projectedFieldSchema(lawNumberSchema, 'official_source', 'prepublication_only'),
    ano: projectedFieldSchema(lawYearSchema, 'official_source', 'prepublication_only'),
    ramo: projectedFieldSchema(lawBranchSchema, 'editorial', 'editable'),
    fonte: projectedFieldSchema(sourceUrlSchema, 'source_catalog', 'read_only'),
    dataPublicacao: projectedFieldSchema(metadataDateSchema, 'official_source', 'editable'),
    dataAtualizacaoLegal: projectedFieldSchema(metadataDateSchema, 'official_source', 'editable'),
    dataFormatacaoVinculex: projectedFieldSchema(metadataDateSchema, 'formatter', 'read_only'),
    totalArtigos: projectedFieldSchema(
      metadataFieldSchemas.totalArtigos,
      'ast_structure',
      'read_only',
    ),
    versaoVinculex: projectedFieldSchema(vinculexSemverSchema, 'publication', 'read_only'),
    legalStatus: projectedFieldSchema(lawLegalStatusSchema, 'editorial', 'editable'),
    publicationStatus: projectedFieldSchema(
      metadataFieldSchemas.publicationStatus,
      'publication',
      'read_only',
    ),
    tags: projectedFieldSchema(lawTagsSchema.nullable(), 'editorial', 'editable'),
    revogadaPor: projectedFieldSchema(revokingLawSchema.nullable(), 'editorial', 'editable'),
    redacoesDadasPor: projectedFieldSchema(
      z.array(referenciaRedacaoSchema).nullable(),
      'ast_structure',
      'read_only',
    ),
    idsDepreciados: projectedFieldSchema(
      z.array(blockIdDepreciadoSchema).nullable(),
      'reconciliation',
      'read_only',
    ),
    fontesSecundarias: projectedFieldSchema(
      secondarySourcesSchema.nullable(),
      'source_catalog',
      'read_only',
    ),
    projectionProfile: projectedFieldSchema(
      contentProjectionProfileSchema,
      'projection',
      'read_only',
    ),
    aliases: projectedFieldSchema(
      z.array(z.string().min(1).max(500)).max(500),
      'reference_catalog',
      'read_only',
    ),
  }),
});

export const frontmatterMetadataFieldPolicy = {
  titulo: { origin: 'import', mutability: 'editable' },
  sigla: { origin: 'import', mutability: 'prepublication_only' },
  tipoNorma: { origin: 'import', mutability: 'prepublication_only' },
  numero: { origin: 'official_source', mutability: 'prepublication_only' },
  ano: { origin: 'official_source', mutability: 'prepublication_only' },
  ramo: { origin: 'editorial', mutability: 'editable' },
  fonte: { origin: 'source_catalog', mutability: 'read_only' },
  dataPublicacao: { origin: 'official_source', mutability: 'editable' },
  dataAtualizacaoLegal: { origin: 'official_source', mutability: 'editable' },
  dataFormatacaoVinculex: { origin: 'formatter', mutability: 'read_only' },
  totalArtigos: { origin: 'ast_structure', mutability: 'read_only' },
  versaoVinculex: { origin: 'publication', mutability: 'read_only' },
  legalStatus: { origin: 'editorial', mutability: 'editable' },
  publicationStatus: { origin: 'publication', mutability: 'read_only' },
  tags: { origin: 'editorial', mutability: 'editable' },
  revogadaPor: { origin: 'editorial', mutability: 'editable' },
  redacoesDadasPor: { origin: 'ast_structure', mutability: 'read_only' },
  idsDepreciados: { origin: 'reconciliation', mutability: 'read_only' },
  fontesSecundarias: { origin: 'source_catalog', mutability: 'read_only' },
  projectionProfile: { origin: 'projection', mutability: 'read_only' },
  aliases: { origin: 'reference_catalog', mutability: 'read_only' },
} as const;

type FieldPolicy =
  (typeof frontmatterMetadataFieldPolicy)[keyof typeof frontmatterMetadataFieldPolicy];
type BlockedReason = z.infer<typeof metadataBlockedReasonSchema>;

const accessFor = (
  policy: FieldPolicy,
  publicationHistoryState: z.infer<typeof publicationHistoryStateSchema>,
): Readonly<{ editable: boolean; blockedReason: BlockedReason | null }> => {
  if (policy.mutability === 'editable') return { editable: true, blockedReason: null };
  if (policy.mutability === 'prepublication_only') {
    if (publicationHistoryState === 'never_published') {
      return { editable: true, blockedReason: null };
    }
    return {
      editable: false,
      blockedReason:
        publicationHistoryState === 'published'
          ? 'published_identity'
          : 'publication_history_unknown',
    };
  }
  return {
    editable: false,
    blockedReason:
      policy.origin === 'source_catalog'
        ? 'source_managed'
        : policy.origin === 'formatter' ||
            policy.origin === 'ast_structure' ||
            policy.origin === 'publication'
          ? 'system_managed'
          : 'derived_value',
  };
};

const field = <Value>(
  value: Value,
  policy: FieldPolicy,
  publicationHistoryState: z.infer<typeof publicationHistoryStateSchema>,
) => ({ value, ...policy, ...accessFor(policy, publicationHistoryState) });

export const projectFrontmatterMetadata = (
  rawAst: unknown,
  rawContext: unknown,
): FrontmatterMetadataProjection => {
  const ast = identifiedNormaAstSchema.parse(rawAst);
  const context = frontmatterMetadataContextSchema.parse(rawContext);
  const state = context.publicationHistoryState;
  const policies = frontmatterMetadataFieldPolicy;
  return frontmatterMetadataProjectionSchema.parse({
    publicationHistoryState: state,
    fields: {
      titulo: field(ast.titulo, policies.titulo, state),
      sigla: field(ast.sigla, policies.sigla, state),
      tipoNorma: field(ast.tipoNorma, policies.tipoNorma, state),
      numero: field(ast.numero, policies.numero, state),
      ano: field(ast.ano, policies.ano, state),
      ramo: field(ast.ramo, policies.ramo, state),
      fonte: field(ast.fonte, policies.fonte, state),
      dataPublicacao: field(ast.dataPublicacao, policies.dataPublicacao, state),
      dataAtualizacaoLegal: field(ast.dataAtualizacaoLegal, policies.dataAtualizacaoLegal, state),
      dataFormatacaoVinculex: field(
        ast.dataFormatacaoVinculex,
        policies.dataFormatacaoVinculex,
        state,
      ),
      totalArtigos: field(ast.totalArtigos, policies.totalArtigos, state),
      versaoVinculex: field(ast.versaoVinculex, policies.versaoVinculex, state),
      legalStatus: field(ast.legalStatus, policies.legalStatus, state),
      publicationStatus: field(ast.publicationStatus, policies.publicationStatus, state),
      tags: field(ast.tags ?? null, policies.tags, state),
      revogadaPor: field(ast.revogadaPor ?? null, policies.revogadaPor, state),
      redacoesDadasPor: field(ast.redacoesDadasPor ?? null, policies.redacoesDadasPor, state),
      idsDepreciados: field(ast.idsDepreciados ?? null, policies.idsDepreciados, state),
      fontesSecundarias: field(ast.fontesSecundarias ?? null, policies.fontesSecundarias, state),
      projectionProfile: field(context.projectionProfile, policies.projectionProfile, state),
      aliases: field(context.aliases, policies.aliases, state),
    },
  });
};

const identityFields = new Set(['sigla', 'tipoNorma', 'numero', 'ano']);
const readOnlyFields = new Set([
  'fonte',
  'dataFormatacaoVinculex',
  'totalArtigos',
  'versaoVinculex',
  'publicationStatus',
  'redacoesDadasPor',
  'idsDepreciados',
  'fontesSecundarias',
  'projectionProfile',
  'aliases',
]);

export const metadataPolicyErrorCodeSchema = z.enum([
  'metadata_field_not_editable',
  'published_identity_immutable',
  'publication_history_required',
  'metadata_cross_field_invalid',
]);

export type MetadataPolicyResult =
  | Readonly<{
      ok: true;
      changes: EditableLawMetadataChanges;
      changesIdentity: boolean;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: MetadataPolicyErrorCode;
        message: string;
      }>;
    }>;

export const validateLawMetadataChangesPolicy = (
  rawAst: unknown,
  rawChanges: unknown,
  publicationHistoryState: unknown,
): MetadataPolicyResult => {
  const ast = identifiedNormaAstSchema.parse(rawAst);
  const changes = lawMetadataCommandChangesSchema.parse(rawChanges);
  const state = publicationHistoryStateSchema.parse(publicationHistoryState);
  const changedFields = Object.keys(changes);
  if (changedFields.some((name) => readOnlyFields.has(name))) {
    return {
      ok: false,
      error: {
        code: 'metadata_field_not_editable',
        message: 'O comando tenta alterar metadado controlado por outra autoridade.',
      },
    };
  }
  const changesIdentity = changedFields.some((name) => identityFields.has(name));
  if (changesIdentity && state === 'published') {
    return {
      ok: false,
      error: {
        code: 'published_identity_immutable',
        message: 'A identidade de uma norma já publicada é imutável.',
      },
    };
  }
  if (changesIdentity && state === 'unknown') {
    return {
      ok: false,
      error: {
        code: 'publication_history_required',
        message:
          'É necessário comprovar que a norma nunca foi publicada para alterar sua identidade.',
      },
    };
  }
  const editableChanges = editableLawMetadataChangesSchema.parse(changes);
  const candidate = identifiedNormaAstSchema.safeParse({ ...ast, ...editableChanges });
  if (!candidate.success) {
    return {
      ok: false,
      error: {
        code: 'metadata_cross_field_invalid',
        message: 'A alteração produziria metadados incompatíveis com a NormaAST.',
      },
    };
  }
  if (candidate.data.dataAtualizacaoLegal < candidate.data.dataPublicacao) {
    return {
      ok: false,
      error: {
        code: 'metadata_cross_field_invalid',
        message: 'A data da atualização jurídica não pode ser anterior à publicação da norma.',
      },
    };
  }
  if (
    candidate.data.revogadaPor !== null &&
    candidate.data.revogadaPor !== undefined &&
    candidate.data.legalStatus !== 'revogada'
  ) {
    return {
      ok: false,
      error: {
        code: 'metadata_cross_field_invalid',
        message:
          'Uma norma revogadora só pode ser informada quando o estado jurídico for revogada.',
      },
    };
  }
  return { ok: true, changes: editableChanges, changesIdentity };
};

export type PublicationHistoryState = z.infer<typeof publicationHistoryStateSchema>;
export type MetadataMutability = z.infer<typeof metadataMutabilitySchema>;
export type MetadataOrigin = z.infer<typeof metadataOriginSchema>;
export type MetadataBlockedReason = z.infer<typeof metadataBlockedReasonSchema>;
export type MetadataPolicyErrorCode = z.infer<typeof metadataPolicyErrorCodeSchema>;
export type EditableLawMetadataChanges = z.infer<typeof editableLawMetadataChangesSchema>;
export type LawMetadataCommandChanges = z.infer<typeof lawMetadataCommandChangesSchema>;
export type FrontmatterMetadataContext = z.infer<typeof frontmatterMetadataContextSchema>;
export type FrontmatterMetadataProjection = z.infer<typeof frontmatterMetadataProjectionSchema>;

export type { IdentifiedNormaAST };
