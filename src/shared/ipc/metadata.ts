import { z } from 'zod';

import { DesktopErrorDtoSchema } from './desktop-api.js';

export const METADATA_GET_STATE_CHANNEL = 'metadata:get-state' as const;
export const METADATA_UPDATE_CHANNEL = 'metadata:update' as const;

export const DESKTOP_METADATA_LIMITS = Object.freeze({
  commandBytes: 32 * 1024,
  stateBytes: 128 * 1024,
  maxReasonCharacters: 2_000,
  maxTags: 100,
  maxAliases: 500,
} as const);

const opaqueIdSchema = z.uuid();
const revisionHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const requiredText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => value.trim().length > 0);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  });
const lawTypeSchema = z.enum([
  'lei ordinária',
  'lei complementar',
  'decreto-lei',
  'decreto',
  'medida provisória',
  'emenda constitucional',
  'código',
  'constituição',
]);
const legalStatusSchema = z.enum([
  'vigente',
  'revogada',
  'alterada',
  'suspensa',
  'sem_eficacia',
  'desconhecida',
]);
const publicationStatusSchema = z.enum([
  'draft',
  'review',
  'approved',
  'published',
  'archived',
  'outdated',
]);
const projectionProfileSchema = z.enum(['complete_with_history', 'current_only']);
const tagsSchema = z
  .array(requiredText(120))
  .max(DESKTOP_METADATA_LIMITS.maxTags)
  .refine((tags) => new Set(tags).size === tags.length);
const acronymSchema = requiredText(80).regex(/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/u);

export const MetadataPublicationHistoryStateSchema = z.enum([
  'never_published',
  'published',
  'unknown',
]);
export const MetadataMutabilityDtoSchema = z.enum(['editable', 'prepublication_only', 'read_only']);
export const MetadataOriginDtoSchema = z.enum([
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
export const MetadataBlockedReasonDtoSchema = z.enum([
  'published_identity',
  'publication_history_unknown',
  'source_managed',
  'system_managed',
  'derived_value',
]);

const fieldSchema = <Value extends z.ZodType>(value: Value) =>
  z.strictObject({
    value,
    origin: MetadataOriginDtoSchema,
    mutability: MetadataMutabilityDtoSchema,
    editable: z.boolean(),
    blockedReason: MetadataBlockedReasonDtoSchema.nullable(),
  });

export const MetadataStateDtoSchema = z.strictObject({
  projectId: opaqueIdSchema,
  revisionHash: revisionHashSchema,
  journalSequence: z.int().nonnegative(),
  publicationHistoryState: MetadataPublicationHistoryStateSchema,
  fields: z.strictObject({
    titulo: fieldSchema(requiredText(500)),
    sigla: fieldSchema(acronymSchema),
    tipoNorma: fieldSchema(lawTypeSchema),
    numero: fieldSchema(requiredText(80)),
    ano: fieldSchema(z.int().min(1000).max(9999)),
    ramo: fieldSchema(requiredText(160)),
    fonte: fieldSchema(z.url().max(2_048)),
    dataPublicacao: fieldSchema(dateSchema),
    dataAtualizacaoLegal: fieldSchema(dateSchema),
    dataFormatacaoVinculex: fieldSchema(dateSchema),
    totalArtigos: fieldSchema(z.int().nonnegative()),
    versaoVinculex: fieldSchema(z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u)),
    legalStatus: fieldSchema(legalStatusSchema),
    publicationStatus: fieldSchema(publicationStatusSchema),
    tags: fieldSchema(tagsSchema.nullable()),
    revogadaPor: fieldSchema(requiredText(500).nullable()),
    redacoesDadasPor: fieldSchema(z.int().nonnegative()),
    idsDepreciados: fieldSchema(z.int().nonnegative()),
    fontesSecundarias: fieldSchema(z.int().nonnegative()),
    projectionProfile: fieldSchema(projectionProfileSchema),
    aliases: fieldSchema(z.array(requiredText(500)).max(DESKTOP_METADATA_LIMITS.maxAliases)),
  }),
});

export const GetMetadataStateCommandSchema = z.strictObject({ projectId: opaqueIdSchema });
export const UpdateMetadataCommandSchema = z.strictObject({
  projectId: opaqueIdSchema,
  expectedRevisionHash: revisionHashSchema,
  changes: z
    .strictObject({
      titulo: requiredText(500).optional(),
      sigla: acronymSchema.optional(),
      tipoNorma: lawTypeSchema.optional(),
      numero: requiredText(80).optional(),
      ano: z.int().min(1000).max(9999).optional(),
      ramo: requiredText(160).optional(),
      dataPublicacao: dateSchema.optional(),
      dataAtualizacaoLegal: dateSchema.optional(),
      legalStatus: legalStatusSchema.optional(),
      tags: tagsSchema.optional(),
      revogadaPor: requiredText(500).nullable().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0),
  reason: requiredText(DESKTOP_METADATA_LIMITS.maxReasonCharacters),
});

const resultSchema = <Value extends z.ZodType>(value: Value) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);

export const GetMetadataStateResultSchema = resultSchema(MetadataStateDtoSchema);
export const UpdateMetadataResultSchema = resultSchema(MetadataStateDtoSchema);

export type GetMetadataStateCommand = z.infer<typeof GetMetadataStateCommandSchema>;
export type UpdateMetadataCommand = z.infer<typeof UpdateMetadataCommandSchema>;
export type MetadataStateDto = z.infer<typeof MetadataStateDtoSchema>;
export type GetMetadataStateResult = z.infer<typeof GetMetadataStateResultSchema>;
export type UpdateMetadataResult = z.infer<typeof UpdateMetadataResultSchema>;
