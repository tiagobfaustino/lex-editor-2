// Enums da NormaAST, conforme `docs/architecture/DATA_MODEL.md` §NormaAST e
// `docs/architecture/ADR-005-status-fields.md`.
//
// Cada enum é declarado uma única vez, como schema de runtime; o tipo
// TypeScript é inferido dele. Manter as duas formas à mão faria o contrato de
// compilação divergir do contrato de runtime, que é exatamente o que a
// Feature 002 existe para impedir.
//
// A ADR-005 proíbe um campo genérico `status`: cada ciclo de vida tem enum e
// nome próprios — `legalStatus` na lei, `publicationStatus` no fluxo editorial
// e `deviceStatus` no dispositivo.

import { z } from 'zod';

/** Vigência jurídica da lei perante o ordenamento (ADR-005 §1). */
export const legalStatusSchema = z.enum([
  'vigente',
  'revogada',
  'alterada',
  'suspensa',
  'sem_eficacia',
  'desconhecida',
]);

/** Fluxo editorial do conteúdo dentro do Vinculex (ADR-005 §2). */
export const publicationStatusSchema = z.enum([
  'draft',
  'review',
  'approved',
  'published',
  'archived',
  'outdated',
]);

/** Estado individual de um dispositivo dentro da NormaAST (ADR-005 §3). */
export const deviceStatusSchema = z.enum([
  'active',
  'revoked',
  'vetoed',
  'included',
  'amended',
  'renumbered',
  'suspended',
  'unknown',
]);

/** Fase validada da árvore: antes ou depois da atribuição de Block IDs. */
export const astPhaseSchema = z.enum(['parsed', 'identified']);

export const parseConfidenceSchema = z.enum(['high', 'medium', 'low']);

/** Função do artefato no conjunto de fontes da ADR-009 §1. */
export const sourceRoleSchema = z.enum(['primary_current', 'historical_auxiliary', 'cross_check']);

/**
 * Forma publicada da fonte. A ADR-009 é explícita: a variante não determina
 * sozinha a precedência — quem decide isso é a função (`sourceRole`).
 */
export const sourceVariantSchema = z.enum(['compiled', 'annotated', 'other']);

export const sourceTypeSchema = z.enum(['planalto_html', 'lexml_xml', 'markdown', 'local_file']);

/**
 * Motivo da confiança atribuída pelo parser. A evidência é enumerada, e não um
 * score opaco, para que a revisão humana saiba o que exatamente sustentou a
 * interpretação estrutural.
 */
export const parseConfidenceReasonSchema = z.enum([
  'exact_legal_designator',
  'known_source_markup',
  'hierarchy_inferred_from_context',
  'ambiguous_designator',
  'irregular_table',
  'source_markup_lost',
  'editorial_override',
]);

export const tipoNormaSchema = z.enum([
  'lei ordinária',
  'lei complementar',
  'decreto-lei',
  'decreto',
  'medida provisória',
  'emenda constitucional',
  'código',
  'constituição',
]);

/** Discriminantes de todos os nós reconhecidos pela NormaAST. */
export const tipoNoSchema = z.enum([
  'lei',
  'livro',
  'titulo',
  'capitulo',
  'secao',
  'subsecao',
  'artigo',
  'paragrafo',
  'inciso',
  'alinea',
  'item',
  'pena',
  'anexo',
  'tabela',
]);

export type LegalStatus = z.infer<typeof legalStatusSchema>;
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type AstPhase = z.infer<typeof astPhaseSchema>;
export type ParseConfidence = z.infer<typeof parseConfidenceSchema>;
export type SourceRole = z.infer<typeof sourceRoleSchema>;
export type SourceVariant = z.infer<typeof sourceVariantSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;
export type ParseConfidenceReason = z.infer<typeof parseConfidenceReasonSchema>;
export type TipoNorma = z.infer<typeof tipoNormaSchema>;
export type TipoNo = z.infer<typeof tipoNoSchema>;

/**
 * Nós referenciáveis: os que exigem Block ID na fase `identified`. Divisões
 * estruturais e a raiz ficam de fora por decisão do DATA_MODEL, não por
 * omissão.
 */
export const TIPOS_REFERENCIAVEIS = [
  'artigo',
  'paragrafo',
  'inciso',
  'alinea',
  'item',
  'pena',
  'anexo',
  'tabela',
] as const satisfies readonly TipoNo[];

export type TipoReferenciavel = (typeof TIPOS_REFERENCIAVEIS)[number];

/** Divisões estruturais: Block ID é opcional e ausente por padrão. */
export const TIPOS_DIVISAO = [
  'livro',
  'titulo',
  'capitulo',
  'secao',
  'subsecao',
] as const satisfies readonly TipoNo[];

export type TipoDivisao = (typeof TIPOS_DIVISAO)[number];
