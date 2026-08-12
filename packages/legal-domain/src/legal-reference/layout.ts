import type { z } from 'zod';
import { z as zod } from 'zod';

import {
  criarProblema,
  falha,
  problemasDoZod,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { validarIdentifiedNormaAst } from '../ast/validate.js';
import { projectContent, type ContentProjectionProfile } from '../content-projection/index.js';
import {
  calculateRevisionHash,
  revisionHashSchema,
  type RevisionHashFunction,
} from '../editorial-commands/index.js';
import { legalNormCatalogSchema, legalNormIdentityKey, type LegalNormCatalog } from './catalog.js';
import { legalNormIdentitySchema } from './contracts.js';

const blockIdSchema = zod
  .string()
  .max(240)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Esperado Block ID canônico, sem "^".');

const segmentoWikiSchema = zod
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Esperado segmento wiki canônico.');

export const vincuLexWikiPathSchema = zod
  .string()
  .max(1_000)
  .regex(
    /^VincuLex\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    'Esperado path wiki relativo ao vault sob VincuLex e sem extensão.',
  );

export const vincuLexLayoutEntrySchema = zod.strictObject({
  canonicalKey: zod.string().min(1).max(240),
  law: legalNormIdentitySchema,
  revisionHash: revisionHashSchema,
  directoryName: segmentoWikiSchema,
  fileName: segmentoWikiSchema,
  wikiPath: vincuLexWikiPathSchema,
  aliases: zod.array(zod.string().min(1).max(500)).max(500),
  blockIds: zod.array(blockIdSchema).max(100_000),
});

export const vincuLexLayoutSchema = zod
  .strictObject({
    schemaVersion: zod.literal(1),
    rootDirectory: zod.literal('VincuLex'),
    profile: zod.enum(['complete_with_history', 'current_only']),
    entries: zod.array(vincuLexLayoutEntrySchema).max(10_000),
  })
  .superRefine((layout, ctx) => {
    const paths = new Set<string>();
    const keys = new Set<string>();
    let previousKey: string | undefined;

    for (const [index, entry] of layout.entries.entries()) {
      if (entry.canonicalKey !== legalNormIdentityKey(entry.law)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'canonicalKey'],
          message: 'A chave do layout não corresponde à identidade jurídica.',
        });
      }
      if (entry.wikiPath !== `VincuLex/${entry.directoryName}/${entry.fileName}`) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'wikiPath'],
          message: 'O path wiki não corresponde aos segmentos declarados.',
        });
      }
      if (keys.has(entry.canonicalKey) || paths.has(entry.wikiPath)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index],
          message: 'Identidades e paths wiki devem ser únicos no layout.',
        });
      }
      keys.add(entry.canonicalKey);
      paths.add(entry.wikiPath);
      if (previousKey !== undefined && entry.canonicalKey < previousKey) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index],
          message: 'As entradas do layout devem estar em ordem canônica.',
        });
      }
      previousKey = entry.canonicalKey;

      if (new Set(entry.aliases).size !== entry.aliases.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'aliases'],
          message: 'Aliases de frontmatter não podem se repetir.',
        });
      }
      if (
        new Set(entry.blockIds).size !== entry.blockIds.length ||
        entry.blockIds.some(
          (blockId, position) =>
            position > 0 && blockId < (entry.blockIds[position - 1] ?? blockId),
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'blockIds'],
          message: 'Block IDs devem ser únicos e estar em ordem canônica.',
        });
      }
    }
  });

export type VincuLexLayoutEntry = z.infer<typeof vincuLexLayoutEntrySchema>;
export type VincuLexLayout = z.infer<typeof vincuLexLayoutSchema>;

export interface VincuLexLayoutDocument {
  readonly ast: unknown;
}

export interface CreateVincuLexLayoutOptions {
  readonly sha256: RevisionHashFunction;
}

/** Paths são projeção de exportação; não participam da identidade jurídica. */
export const slugifyVincuLexSegment = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-');

const identityFromAst = (ast: IdentifiedNormaAST) => ({
  tipoNorma: ast.tipoNorma,
  numero: ast.numero,
  ano: ast.ano,
});

const blockIdsFrom = (ast: IdentifiedNormaAST): string[] => {
  const blockIds: string[] = [];
  const visit = (node: Record<string, unknown>): void => {
    if (typeof node['blockId'] === 'string') blockIds.push(node['blockId']);
    const children = Array.isArray(node['children'])
      ? (node['children'] as Record<string, unknown>[])
      : [];
    for (const child of children) visit(child);
  };
  visit(ast as unknown as Record<string, unknown>);
  return blockIds.sort((left, right) => left.localeCompare(right, 'en'));
};

const aliasesFromCatalog = (entry: LegalNormCatalog['entries'][number]): string[] =>
  entry.aliases
    .map(({ display }) => display.trim())
    .filter((display) => display !== entry.title)
    .sort((left, right) => left.localeCompare(right, 'pt-BR'));

/** Deriva o layout apenas do catálogo e das revisões efetivamente exportáveis. */
export const createVincuLexLayout = (
  catalogInput: unknown,
  documents: readonly VincuLexLayoutDocument[],
  profile: ContentProjectionProfile,
  options: CreateVincuLexLayoutOptions,
): ResultadoValidacao<Readonly<VincuLexLayout>> => {
  const catalogResult = legalNormCatalogSchema.safeParse(catalogInput);
  if (!catalogResult.success) return falha(problemasDoZod(catalogResult.error));
  const catalog = catalogResult.data;
  const entries: VincuLexLayoutEntry[] = [];
  const seen = new Set<string>();

  for (const [index, document] of documents.entries()) {
    const validation = validarIdentifiedNormaAst(document.ast);
    if (!validation.ok) return validation;
    const ast = validation.valor;
    const canonicalKey = legalNormIdentityKey(identityFromAst(ast));
    if (seen.has(canonicalKey)) {
      return falha([
        criarProblema(
          'pacote_vinculex_invalido',
          ['documents', index],
          `A norma ${canonicalKey} foi incluída mais de uma vez no pacote.`,
        ),
      ]);
    }
    seen.add(canonicalKey);

    const catalogEntry = catalog.entries.find((entry) => entry.canonicalKey === canonicalKey);
    if (catalogEntry === undefined) {
      return falha([
        criarProblema(
          'pacote_vinculex_invalido',
          ['documents', index],
          `A norma ${canonicalKey} não existe no catálogo selecionado.`,
        ),
      ]);
    }

    let revisionHash: string;
    try {
      revisionHash = calculateRevisionHash(ast, options.sha256);
    } catch {
      return falha([
        criarProblema(
          'pacote_vinculex_invalido',
          ['documents', index, 'revisionHash'],
          'Não foi possível calcular o SHA-256 da revisão exportada.',
        ),
      ]);
    }
    if (catalogEntry.revisionHash !== revisionHash) {
      return falha([
        criarProblema(
          'pacote_vinculex_invalido',
          ['documents', index, 'revisionHash'],
          'A revisão exportada não corresponde à revisão selecionada no catálogo.',
        ),
      ]);
    }

    const projection = projectContent(ast, profile);
    if (!projection.ok) return projection;
    const directoryName = slugifyVincuLexSegment(catalogEntry.title);
    const fileName = slugifyVincuLexSegment(catalogEntry.acronym);
    if (directoryName.length === 0 || fileName.length === 0) {
      return falha([
        criarProblema(
          'pacote_vinculex_invalido',
          ['documents', index],
          'Título e sigla precisam produzir segmentos wiki não vazios.',
        ),
      ]);
    }

    entries.push({
      canonicalKey,
      law: catalogEntry.law,
      revisionHash: revisionHashSchema.parse(revisionHash),
      directoryName,
      fileName,
      wikiPath: `VincuLex/${directoryName}/${fileName}`,
      aliases: aliasesFromCatalog(catalogEntry),
      blockIds: blockIdsFrom(projection.valor.ast),
    });
  }

  entries.sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey, 'en'));
  const parsed = vincuLexLayoutSchema.safeParse({
    schemaVersion: 1,
    rootDirectory: 'VincuLex',
    profile,
    entries,
  });
  if (!parsed.success) {
    return falha(
      problemasDoZod(parsed.error).map((problem) => ({
        ...problem,
        codigo: 'pacote_vinculex_invalido' as const,
      })),
    );
  }
  return sucesso(Object.freeze(parsed.data));
};
