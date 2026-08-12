// Projeção usada pelo worker para distinguir mudança jurídica de ruído técnico.
//
// O hash de revisão editorial cobre a AST integral e serve à concorrência
// local. Este hash tem outra finalidade: comparar uma ParsedNormaAST recém-
// extraída com a última IdentifiedNormaAST publicada. Por isso identidade,
// proveniência, evidência e metadados operacionais ficam deliberadamente fora.

import { z } from 'zod';

import {
  deviceStatusSchema,
  legalStatusSchema,
  sourceRoleSchema,
  sourceTypeSchema,
  sourceVariantSchema,
  tipoNoSchema,
  type DeviceStatus,
  type LegalStatus,
  type SourceRole,
  type SourceType,
  type SourceVariant,
  type TipoNo,
} from '../ast/enums.js';
import {
  criarProblema,
  falha,
  problemasDoZod,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import { normaAstSchema } from '../ast/schemas.js';
import { montarConjuntoDeFontes, type SourceSnapshot } from '../source/snapshot.js';

const digestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, 'Esperado SHA-256 em hexadecimal minúsculo.');
const normativeChildTypeSchema = tipoNoSchema.exclude(['lei']);

export interface NormativeDeviceProjection {
  readonly tipo: Exclude<TipoNo, 'lei'>;
  readonly ordem: number;
  readonly deviceStatus: DeviceStatus;
  readonly numero?: string | undefined;
  readonly letra?: string | undefined;
  readonly titulo?: string | undefined;
  readonly caput?: string | undefined;
  readonly texto?: string | undefined;
  readonly caption?: string | undefined;
  readonly notaStatus?: string | undefined;
  readonly headers?: readonly string[] | undefined;
  readonly rows?: readonly (readonly string[])[] | undefined;
  readonly children: readonly NormativeDeviceProjection[];
}

export interface NormativeProjection {
  readonly schemaVersion: 1;
  readonly tipo: 'lei';
  readonly legalStatus: LegalStatus;
  readonly revogadaPor?: string | undefined;
  readonly children: readonly NormativeDeviceProjection[];
}

export interface SourceArtifactHash {
  readonly sourceType: SourceType;
  readonly sourceRole: SourceRole;
  readonly sourceVariant: SourceVariant;
  readonly sourceUrl?: string | undefined;
  readonly artifactSha256: string;
}

export interface LegislativeDetectionHashes {
  readonly schemaVersion: 1;
  readonly sourceArtifacts: readonly SourceArtifactHash[];
  readonly normativeSha256: string;
}

export type NormativeSha256Function = (value: string) => string;

export const normativeDeviceProjectionSchema: z.ZodType<NormativeDeviceProjection> = z.lazy(() =>
  z.strictObject({
    tipo: normativeChildTypeSchema,
    ordem: z.int().nonnegative(),
    deviceStatus: deviceStatusSchema,
    numero: z.string().optional(),
    letra: z.string().optional(),
    titulo: z.string().optional(),
    caput: z.string().optional(),
    texto: z.string().optional(),
    caption: z.string().optional(),
    notaStatus: z.string().optional(),
    headers: z.array(z.string()).optional(),
    rows: z.array(z.array(z.string())).optional(),
    children: z.array(normativeDeviceProjectionSchema),
  }),
);

export const normativeProjectionSchema: z.ZodType<NormativeProjection> = z.strictObject({
  schemaVersion: z.literal(1),
  tipo: z.literal('lei'),
  legalStatus: legalStatusSchema,
  revogadaPor: z.string().optional(),
  children: z.array(normativeDeviceProjectionSchema),
});

export const sourceArtifactHashSchema: z.ZodType<SourceArtifactHash> = z.strictObject({
  sourceType: sourceTypeSchema,
  sourceRole: sourceRoleSchema,
  sourceVariant: sourceVariantSchema,
  sourceUrl: z.url().optional(),
  artifactSha256: digestSchema,
});

export const legislativeDetectionHashesSchema: z.ZodType<LegislativeDetectionHashes> =
  z.strictObject({
    schemaVersion: z.literal(1),
    sourceArtifacts: z.array(sourceArtifactHashSchema).min(1).max(100),
    normativeSha256: digestSchema,
  });

/**
 * Normalização conservadora: remove diferenças de Unicode e whitespace, mas
 * preserva pontuação e palavras. Uma vírgula ou sinal jurídico diferente deve
 * continuar mudando o hash.
 */
export const normalizeNormativeText = (value: string): string =>
  value
    .normalize('NFC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .replace(/\u00A0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

/**
 * Normaliza Markdown editorial apenas para comparação auxiliar. A função não
 * produz evidência normativa: remove decorações pessoais e preserva somente o
 * texto visível, que ainda precisa ser confirmado no snapshot oficial.
 */
export const normalizeEditorialReferenceText = (value: string): string =>
  normalizeNormativeText(
    value
      .replace(/<!--[\s\S]*?-->/gu, ' ')
      .replace(/<[^>]*>/gu, ' ')
      .replace(/!?\[\[[^\]|]+\|([^\]]+)\]\]/gu, '$1')
      .replace(/!?\[\[([^\]]+)\]\]/gu, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/u, '')
      .replace(/\^[-a-z0-9]+\b/giu, ' ')
      .replace(/(?:\*{1,3}|__|~~|==|`)/gu, ''),
  );

const optionalText = (
  node: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, string>> => {
  const value = node[key];
  return typeof value === 'string' ? { [key]: normalizeNormativeText(value) } : {};
};

const projectDevice = (rawNode: unknown): NormativeDeviceProjection => {
  const node = rawNode as Readonly<Record<string, unknown>>;
  const headers = Array.isArray(node['headers'])
    ? { headers: node['headers'].map((value) => normalizeNormativeText(String(value))) }
    : {};
  const rows = Array.isArray(node['rows'])
    ? {
        rows: node['rows'].map((row) =>
          Array.isArray(row)
            ? row.map((value) => normalizeNormativeText(String(value)))
            : [normalizeNormativeText(String(row))],
        ),
      }
    : {};
  const children = Array.isArray(node['children']) ? node['children'].map(projectDevice) : [];
  return normativeDeviceProjectionSchema.parse({
    tipo: node['tipo'],
    ordem: node['ordem'],
    deviceStatus: node['deviceStatus'],
    ...optionalText(node, 'numero'),
    ...optionalText(node, 'letra'),
    ...optionalText(node, 'titulo'),
    ...optionalText(node, 'caput'),
    ...optionalText(node, 'texto'),
    ...optionalText(node, 'caption'),
    ...optionalText(node, 'notaStatus'),
    ...headers,
    ...rows,
    children,
  });
};

export const projectNormativeAst = (input: unknown): Readonly<NormativeProjection> => {
  const ast = normaAstSchema.parse(input);
  return Object.freeze(
    normativeProjectionSchema.parse({
      schemaVersion: 1,
      tipo: 'lei',
      legalStatus: ast.legalStatus,
      ...(typeof ast.revogadaPor === 'string'
        ? { revogadaPor: normalizeNormativeText(ast.revogadaPor) }
        : {}),
      children: ast.children.map(projectDevice),
    }),
  );
};

export const canonicalizeNormativeProjection = (input: unknown): string =>
  JSON.stringify(normativeProjectionSchema.parse(projectNormativeAst(input)));

export const calculateNormativeHash = (input: unknown, sha256: NormativeSha256Function): string =>
  digestSchema.parse(sha256(canonicalizeNormativeProjection(input)));

const sourceArtifactSortKey = (artifact: SourceArtifactHash): string =>
  [
    artifact.sourceRole,
    artifact.sourceType,
    artifact.sourceVariant,
    artifact.sourceUrl ?? '',
    artifact.artifactSha256,
  ].join('\u0000');

const compareSourceArtifacts = (left: SourceArtifactHash, right: SourceArtifactHash): number => {
  const leftKey = sourceArtifactSortKey(left);
  const rightKey = sourceArtifactSortKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};

/**
 * Produz a evidência mínima da detecção. O SHA bruto é recalculado sobre os
 * bytes textuais capturados; o SHA normativo é calculado sobre a projeção sem
 * dados operacionais. Nenhum conteúdo bruto é incluído no retorno.
 */
export const createLegislativeDetectionHashes = (options: {
  snapshots: readonly SourceSnapshot[];
  ast: unknown;
  sha256: NormativeSha256Function;
}): ResultadoValidacao<Readonly<LegislativeDetectionHashes>> => {
  const sourceSet = montarConjuntoDeFontes(options.snapshots);
  if (!sourceSet.ok) return sourceSet;

  const seenArtifacts = new Set<string>();
  const sourceArtifacts: SourceArtifactHash[] = [];
  for (const [index, snapshot] of options.snapshots.entries()) {
    let calculatedRawHash: string;
    try {
      calculatedRawHash = digestSchema.parse(options.sha256(snapshot.conteudo));
    } catch {
      return falha([
        criarProblema(
          'schema_invalido',
          ['snapshots', index, 'sha256'],
          'A função SHA-256 não produziu um digest bruto válido.',
        ),
      ]);
    }
    if (calculatedRawHash !== snapshot.sha256) {
      return falha([
        criarProblema(
          'schema_invalido',
          ['snapshots', index, 'sha256'],
          'O conteúdo bruto não corresponde ao SHA-256 declarado pelo snapshot.',
        ),
      ]);
    }
    const artifact = sourceArtifactHashSchema.parse({
      sourceType: snapshot.referencia.sourceType,
      sourceRole: snapshot.referencia.sourceRole,
      sourceVariant: snapshot.referencia.sourceVariant,
      ...(snapshot.referencia.sourceUrl === undefined
        ? {}
        : { sourceUrl: snapshot.referencia.sourceUrl }),
      artifactSha256: calculatedRawHash,
    });
    const identity = sourceArtifactSortKey(artifact);
    if (seenArtifacts.has(identity)) {
      return falha([
        criarProblema(
          'manifesto_invalido',
          ['snapshots', index],
          'O conjunto de fontes contém o mesmo artefato declarado mais de uma vez.',
        ),
      ]);
    }
    seenArtifacts.add(identity);
    sourceArtifacts.push(artifact);
  }

  let normativeSha256: string;
  try {
    normativeSha256 = calculateNormativeHash(options.ast, options.sha256);
  } catch (error) {
    if (error instanceof z.ZodError) return falha(problemasDoZod(error));
    return falha([
      criarProblema(
        'schema_invalido',
        ['normativeSha256'],
        'Não foi possível calcular o hash da projeção normativa.',
      ),
    ]);
  }

  return sucesso(
    Object.freeze(
      legislativeDetectionHashesSchema.parse({
        schemaVersion: 1,
        sourceArtifacts: sourceArtifacts.sort(compareSourceArtifacts),
        normativeSha256,
      }),
    ),
  );
};
