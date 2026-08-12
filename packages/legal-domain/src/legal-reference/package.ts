import type { z } from 'zod';
import { z as zod } from 'zod';

import {
  criarProblema,
  falha,
  problemasDoZod,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { ContentProjectionProfile } from '../content-projection/index.js';
import { revisionHashSchema, type RevisionHashFunction } from '../editorial-commands/index.js';
import { formatar } from '../formatter/index.js';
import { validarMarkdownCanonico } from '../formatter/validar-canonico.js';
import { legalNormCatalogSchema, legalNormIdentityKey } from './catalog.js';
import { legalReferenceIndexSchema, type LegalReferenceIndex } from './contracts.js';
import { createVincuLexLayout, vincuLexLayoutSchema, type VincuLexLayout } from './layout.js';

const relativeMarkdownPathSchema = zod
  .string()
  .max(1_000)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u,
    'Esperado arquivo Markdown relativo ao diretório VincuLex.',
  );

export const vincuLexPackageFileSchema = zod.strictObject({
  canonicalKey: zod.string().min(1).max(240),
  relativePath: relativeMarkdownPathSchema,
  contentSha256: revisionHashSchema,
  byteLength: zod.int().nonnegative(),
  markdown: zod.string().min(1).max(50_000_000),
});

export const vincuLexPackageSchema = zod
  .strictObject({
    schemaVersion: zod.literal(1),
    rootDirectory: zod.literal('VincuLex'),
    profile: zod.enum(['complete_with_history', 'current_only']),
    layout: vincuLexLayoutSchema,
    files: zod.array(vincuLexPackageFileSchema).max(10_000),
  })
  .superRefine((pkg, ctx) => {
    if (pkg.layout.profile !== pkg.profile) {
      ctx.addIssue({
        code: 'custom',
        path: ['layout', 'profile'],
        message: 'Layout e pacote devem usar o mesmo perfil.',
      });
    }
    const paths = new Set<string>();
    const keys = new Set<string>();
    let previousPath: string | undefined;
    for (const [index, file] of pkg.files.entries()) {
      if (paths.has(file.relativePath) || keys.has(file.canonicalKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', index],
          message: 'Cada norma e arquivo devem aparecer uma única vez no pacote.',
        });
      }
      paths.add(file.relativePath);
      keys.add(file.canonicalKey);
      if (previousPath !== undefined && file.relativePath < previousPath) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', index],
          message: 'Os arquivos devem estar em ordem canônica de path.',
        });
      }
      previousPath = file.relativePath;
    }
  });

export type VincuLexPackageFile = z.infer<typeof vincuLexPackageFileSchema>;
export type VincuLexPackage = z.infer<typeof vincuLexPackageSchema>;

export interface VincuLexPackageDocument {
  readonly ast: unknown;
  readonly referenceIndex: unknown;
}

export interface CreateVincuLexPackageInput {
  readonly catalog: unknown;
  readonly documents: readonly VincuLexPackageDocument[];
  readonly profile: ContentProjectionProfile;
}

export interface VincuLexPackageCrypto {
  readonly sha256: RevisionHashFunction;
}

const invalid = (path: readonly (string | number)[], message: string) =>
  falha([criarProblema('pacote_vinculex_invalido', path, message)]);

const filePathFor = (entry: VincuLexLayout['entries'][number]): string =>
  `${entry.directoryName}/${entry.fileName}.md`;

const utf8ByteLength = (value: string): number => {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
};

const parsePackage = (input: unknown): ResultadoValidacao<VincuLexPackage> => {
  const parsed = vincuLexPackageSchema.safeParse(input);
  return parsed.success
    ? sucesso(parsed.data)
    : falha(
        problemasDoZod(parsed.error).map((problem) => ({
          ...problem,
          codigo: 'pacote_vinculex_invalido' as const,
        })),
      );
};

const WIKILINK =
  /\[\[(?:(VincuLex\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*))?#\^([a-z0-9]+(?:-[a-z0-9]+)*)\|([^\]\r\n]+)\]\]/gu;

/** Valida o lote inteiro antes de qualquer escrita no filesystem. */
export const validateVincuLexPackage = (
  input: unknown,
  crypto: VincuLexPackageCrypto,
): ResultadoValidacao<Readonly<VincuLexPackage>> => {
  const parsed = parsePackage(input);
  if (!parsed.ok) return parsed;
  const pkg = parsed.valor;
  const fileByWikiPath = new Map<string, VincuLexPackageFile>();
  const entryByKey = new Map(pkg.layout.entries.map((entry) => [entry.canonicalKey, entry]));

  for (const entry of pkg.layout.entries) {
    const file = pkg.files.find(({ canonicalKey }) => canonicalKey === entry.canonicalKey);
    if (file?.relativePath !== filePathFor(entry)) {
      return invalid(
        ['files'],
        `A entrada ${entry.canonicalKey} não possui exatamente o arquivo previsto pelo layout.`,
      );
    }
    fileByWikiPath.set(entry.wikiPath, file);
  }
  if (pkg.files.length !== pkg.layout.entries.length) {
    return invalid(['files'], 'O pacote contém arquivo sem entrada correspondente no layout.');
  }

  for (const [index, file] of pkg.files.entries()) {
    let calculatedHash: string;
    try {
      calculatedHash = revisionHashSchema.parse(crypto.sha256(file.markdown));
    } catch {
      return invalid(['files', index, 'contentSha256'], 'Não foi possível calcular o SHA-256.');
    }
    if (
      calculatedHash !== file.contentSha256 ||
      utf8ByteLength(file.markdown) !== file.byteLength
    ) {
      return invalid(
        ['files', index],
        'Hash ou tamanho não corresponde aos bytes Markdown declarados.',
      );
    }

    const sourceEntry = entryByKey.get(file.canonicalKey);
    if (sourceEntry === undefined) return invalid(['files', index], 'Norma de origem ausente.');
    const anchors = [...file.markdown.matchAll(/ \^([a-z0-9]+(?:-[a-z0-9]+)*)$/gmu)].map(
      (match) => match[1] ?? '',
    );
    if (
      new Set(anchors).size !== anchors.length ||
      JSON.stringify([...anchors].sort((left, right) => left.localeCompare(right, 'en'))) !==
        JSON.stringify(sourceEntry.blockIds)
    ) {
      return invalid(
        ['files', index, 'markdown'],
        'As âncoras do Markdown não correspondem aos Block IDs previstos pelo layout.',
      );
    }
    const aliasLines = file.markdown
      .slice(0, file.markdown.indexOf('\n---\n', 4))
      .split('\n')
      .filter((line) => line.startsWith('aliases:'));
    const expectedAliasLine =
      sourceEntry.aliases.length === 0
        ? undefined
        : `aliases: [${sourceEntry.aliases.map((alias) => JSON.stringify(alias)).join(', ')}]`;
    if (
      (expectedAliasLine === undefined && aliasLines.length > 0) ||
      (expectedAliasLine !== undefined &&
        (aliasLines.length !== 1 || aliasLines[0] !== expectedAliasLine))
    ) {
      return invalid(
        ['files', index, 'markdown'],
        'Os aliases do Markdown não correspondem ao layout canônico.',
      );
    }
    const profileLines = file.markdown
      .split('\n')
      .filter((line) => line.startsWith('projection_profile:'));
    if (
      (pkg.profile === 'current_only' &&
        (profileLines.length !== 1 || profileLines[0] !== 'projection_profile: "current_only"')) ||
      (pkg.profile === 'complete_with_history' && profileLines.length > 0)
    ) {
      return invalid(
        ['files', index, 'markdown'],
        'O rótulo de perfil do Markdown não corresponde ao pacote.',
      );
    }
    const links = [...file.markdown.matchAll(WIKILINK)];
    const openingCount = file.markdown.match(/\[\[/gu)?.length ?? 0;
    if (links.length !== openingCount || file.markdown.includes('![[')) {
      return invalid(
        ['files', index, 'markdown'],
        'O pacote contém wikilink não canônico ou embed não suportado.',
      );
    }
    for (const link of links) {
      const wikiPath = link[1];
      const blockId = link[2];
      const targetEntry =
        wikiPath === undefined
          ? sourceEntry
          : pkg.layout.entries.find((entry) => entry.wikiPath === wikiPath);
      if (
        targetEntry === undefined ||
        blockId === undefined ||
        !targetEntry.blockIds.includes(blockId)
      ) {
        return invalid(
          ['files', index, 'markdown'],
          'O Markdown contém wikilink para nota ou Block ID ausente do pacote.',
        );
      }
      if (wikiPath !== undefined && !fileByWikiPath.has(wikiPath)) {
        return invalid(
          ['files', index, 'markdown'],
          'O wikilink externo aponta para arquivo ausente.',
        );
      }
    }
  }

  return sucesso(Object.freeze(pkg));
};

/** Materializa todas as notas e só devolve um lote integralmente validado. */
export const createVincuLexPackage = (
  input: CreateVincuLexPackageInput,
  crypto: VincuLexPackageCrypto,
): ResultadoValidacao<Readonly<VincuLexPackage>> => {
  const layout = createVincuLexLayout(
    input.catalog,
    input.documents.map(({ ast }) => ({ ast })),
    input.profile,
    crypto,
  );
  if (!layout.ok) return layout;
  const catalog = legalNormCatalogSchema.parse(input.catalog);
  const files: VincuLexPackageFile[] = [];

  for (const [index, document] of input.documents.entries()) {
    const referenceResult = legalReferenceIndexSchema.safeParse(document.referenceIndex);
    if (!referenceResult.success) {
      return invalid(
        ['documents', index, 'referenceIndex'],
        'O documento possui um índice de referências inválido.',
      );
    }
    const referenceIndex: LegalReferenceIndex = referenceResult.data;
    const canonicalKey = legalNormIdentityKey(referenceIndex.law);
    const entry = layout.valor.entries.find((candidate) => candidate.canonicalKey === canonicalKey);
    if (
      entry === undefined ||
      !catalog.entries.some((candidate) => candidate.canonicalKey === canonicalKey)
    ) {
      return invalid(
        ['documents', index],
        'Documento e índice não correspondem ao catálogo/layout.',
      );
    }
    const options = { referenceIndex, layout: layout.valor, sha256: crypto.sha256 };
    const formatted = formatar(document.ast, input.profile, options);
    if (!formatted.ok) return formatted;
    const canonicalProblems = validarMarkdownCanonico(
      formatted.valor,
      document.ast as Parameters<typeof validarMarkdownCanonico>[1],
      input.profile,
      options,
    );
    if (canonicalProblems.length > 0) return falha(canonicalProblems);
    const contentSha256 = revisionHashSchema.parse(crypto.sha256(formatted.valor));
    files.push({
      canonicalKey,
      relativePath: filePathFor(entry),
      contentSha256,
      byteLength: utf8ByteLength(formatted.valor),
      markdown: formatted.valor,
    });
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
  return validateVincuLexPackage(
    {
      schemaVersion: 1,
      rootDirectory: 'VincuLex',
      profile: input.profile,
      layout: layout.valor,
      files,
    },
    crypto,
  );
};
