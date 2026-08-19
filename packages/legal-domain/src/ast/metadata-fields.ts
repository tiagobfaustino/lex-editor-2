import { z } from 'zod';

import { legalStatusSchema, publicationStatusSchema, tipoNormaSchema } from './enums.js';

const boundedRequiredText = (label: string, maximum: number) =>
  z
    .string()
    .max(maximum, `${label} excede o limite de ${String(maximum)} caracteres.`)
    .check((ctx) => {
      if (ctx.value.trim().length === 0) {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: `${label} não pode ser vazio.`,
        });
      }
    });

/** Data civil real, sem normalização ou consulta ao relógio. */
export const metadataDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Esperada data no formato YYYY-MM-DD.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Data inexistente no calendário.');

export const vinculexSemverSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u, 'Esperado SemVer, ex.: 1.3.0.');

export const lawTitleSchema = boundedRequiredText('O título', 500);
export const lawAcronymSchema = boundedRequiredText('A sigla', 80).regex(
  /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/u,
  'A sigla deve usar letras ASCII, dígitos e hífen apenas como separador; o gerador normaliza seu segmento no Block ID.',
);
export const lawTypeSchema = tipoNormaSchema;
export const lawNumberSchema = boundedRequiredText('O número da norma', 80);
export const lawYearSchema = z.int().min(1000).max(9999);
export const lawBranchSchema = boundedRequiredText('O ramo jurídico', 160);
export const sourceUrlSchema = z.url().max(2_048);
export const lawLegalStatusSchema = legalStatusSchema;
export const lawPublicationStatusSchema = publicationStatusSchema;
export const revokingLawSchema = boundedRequiredText('A norma revogadora', 500).nullable();

export const lawTagsSchema = z
  .array(boundedRequiredText('A tag', 120))
  .max(100)
  .check((ctx) => {
    const seen = new Set<string>();
    ctx.value.forEach((tag, index) => {
      if (seen.has(tag)) {
        ctx.issues.push({
          code: 'custom',
          input: tag,
          path: [index],
          message: 'Uma tag não pode aparecer mais de uma vez.',
        });
      }
      seen.add(tag);
    });
  });

export const secondarySourcesSchema = z.array(sourceUrlSchema).max(100);

export const metadataFieldSchemas = {
  titulo: lawTitleSchema,
  sigla: lawAcronymSchema,
  tipoNorma: lawTypeSchema,
  numero: lawNumberSchema,
  ano: lawYearSchema,
  ramo: lawBranchSchema,
  fonte: sourceUrlSchema,
  dataPublicacao: metadataDateSchema,
  dataAtualizacaoLegal: metadataDateSchema,
  dataFormatacaoVinculex: metadataDateSchema,
  totalArtigos: z.int().nonnegative(),
  versaoVinculex: vinculexSemverSchema,
  legalStatus: lawLegalStatusSchema,
  publicationStatus: lawPublicationStatusSchema,
  tags: lawTagsSchema,
  revogadaPor: revokingLawSchema,
  fontesSecundarias: secondarySourcesSchema,
} as const;
