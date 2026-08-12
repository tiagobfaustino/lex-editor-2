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
import {
  calculateRevisionHash,
  revisionHashSchema,
  type RevisionHashFunction,
} from '../editorial-commands/index.js';
import {
  legalNormIdentitySchema,
  legalReferencePointSchema,
  type LegalNormIdentity,
  type LegalReferencePoint,
} from './contracts.js';

const requiredText = (label: string, maximum: number) =>
  zod
    .string()
    .max(maximum)
    .check((ctx) => {
      if (ctx.value.trim().length === 0) {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: `${label} não pode ser vazio.`,
        });
      }
    });

const blockIdSchema = zod
  .string()
  .max(240)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Esperado Block ID canônico, sem "^".');

export const legalNormCatalogAliasSchema = zod.strictObject({
  display: requiredText('O alias de exibição', 500),
  normalized: requiredText('O alias normalizado', 500),
});

export const legalNormCatalogDeviceSchema = zod.strictObject({
  blockId: blockIdSchema,
  point: legalReferencePointSchema,
});

export const legalNormCatalogEntrySchema = zod.strictObject({
  canonicalKey: requiredText('A chave canônica', 240),
  law: legalNormIdentitySchema,
  revisionHash: revisionHashSchema,
  title: requiredText('O título da norma', 1_000),
  acronym: requiredText('A sigla da norma', 240),
  aliases: zod.array(legalNormCatalogAliasSchema).min(1).max(500),
  devices: zod.array(legalNormCatalogDeviceSchema).max(100_000),
});

export const legalNormCatalogCollisionSchema = zod.strictObject({
  normalizedAlias: requiredText('O alias em colisão', 500),
  canonicalKeys: zod.array(requiredText('A chave canônica em colisão', 240)).min(2).max(100),
});

export const legalNormCatalogSchema = zod
  .strictObject({
    schemaVersion: zod.literal(1),
    entries: zod.array(legalNormCatalogEntrySchema).max(10_000),
    collisions: zod.array(legalNormCatalogCollisionSchema).max(100_000),
  })
  .superRefine((catalog, ctx) => {
    const identityKeys = new Set<string>();
    let previousKey: string | undefined;
    for (const [index, entry] of catalog.entries.entries()) {
      if (identityKeys.has(entry.canonicalKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'canonicalKey'],
          message: 'A identidade canônica deve ser única no catálogo.',
        });
      }
      identityKeys.add(entry.canonicalKey);
      if (previousKey !== undefined && entry.canonicalKey < previousKey) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index],
          message: 'As entradas do catálogo devem estar em ordem canônica.',
        });
      }
      previousKey = entry.canonicalKey;

      if (entry.canonicalKey !== legalNormIdentityKey(entry.law)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'canonicalKey'],
          message: 'A chave canônica não corresponde à identidade jurídica da entrada.',
        });
      }

      const aliases = new Set<string>();
      for (const [aliasIndex, alias] of entry.aliases.entries()) {
        if (alias.normalized !== normalizeLegalNormAlias(alias.display)) {
          ctx.addIssue({
            code: 'custom',
            path: ['entries', index, 'aliases', aliasIndex, 'normalized'],
            message: 'O alias normalizado não corresponde ao texto de exibição.',
          });
        }
        if (aliases.has(alias.normalized)) {
          ctx.addIssue({
            code: 'custom',
            path: ['entries', index, 'aliases', aliasIndex],
            message: 'Uma entrada não pode repetir o mesmo alias normalizado.',
          });
        }
        aliases.add(alias.normalized);
      }

      const blockIds = new Set<string>();
      for (const [deviceIndex, device] of entry.devices.entries()) {
        if (blockIds.has(device.blockId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['entries', index, 'devices', deviceIndex, 'blockId'],
            message: 'Um Block ID deve aparecer uma única vez na revisão catalogada.',
          });
        }
        blockIds.add(device.blockId);
      }
    }

    const keysByAlias = new Map<string, Set<string>>();
    for (const entry of catalog.entries) {
      for (const alias of entry.aliases) {
        const keys = keysByAlias.get(alias.normalized) ?? new Set<string>();
        keys.add(entry.canonicalKey);
        keysByAlias.set(alias.normalized, keys);
      }
    }
    const expectedCollisions = [...keysByAlias.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([normalizedAlias, keys]) => ({
        normalizedAlias,
        canonicalKeys: [...keys].sort((left, right) => left.localeCompare(right, 'en')),
      }))
      .sort((left, right) => left.normalizedAlias.localeCompare(right.normalizedAlias, 'en'));
    if (JSON.stringify(catalog.collisions) !== JSON.stringify(expectedCollisions)) {
      ctx.addIssue({
        code: 'custom',
        path: ['collisions'],
        message: 'As colisões devem corresponder exatamente aos aliases ambíguos do catálogo.',
      });
    }
  });

export type LegalNormCatalogAlias = z.infer<typeof legalNormCatalogAliasSchema>;
export type LegalNormCatalogDevice = z.infer<typeof legalNormCatalogDeviceSchema>;
export type LegalNormCatalogEntry = z.infer<typeof legalNormCatalogEntrySchema>;
export type LegalNormCatalogCollision = z.infer<typeof legalNormCatalogCollisionSchema>;
export type LegalNormCatalog = z.infer<typeof legalNormCatalogSchema>;

export interface LegalNormCatalogInput {
  readonly ast: unknown;
  readonly aliases?: readonly string[];
}

export interface CreateLegalNormCatalogOptions {
  readonly sha256: RevisionHashFunction;
}

/** Normalização somente para descoberta; nunca substitui a identidade jurídica. */
export const normalizeLegalNormAlias = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/(?<=\d)\.(?=\d)/gu, '')
    .replace(/[º°]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\bn\b/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');

const normalizeIdentityNumber = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/gu, '');

export const legalNormIdentityKey = (identity: LegalNormIdentity): string =>
  `${identity.tipoNorma}:${normalizeIdentityNumber(identity.numero)}:${String(identity.ano)}`;

const identityFromAst = (ast: IdentifiedNormaAST): LegalNormIdentity => ({
  tipoNorma: ast.tipoNorma,
  numero: ast.numero,
  ano: ast.ano,
});

const normalizeDesignator = (value: string): string =>
  value
    .normalize('NFC')
    .trim()
    .replace(/[º°o]$/iu, '')
    .replace(/\s*-\s*/gu, '-')
    .replace(/-([A-Za-z]+)$/u, (_whole, suffix: string) => `-${suffix.toUpperCase()}`);

const normalizeParagraph = (value: string): string => {
  const normalized = normalizeDesignator(value);
  return normalized.toLocaleLowerCase('pt-BR') === 'único' || normalized === 'unico'
    ? 'unico'
    : normalized;
};

type UnknownNode = Record<string, unknown>;

const catalogDevicesFromAst = (ast: IdentifiedNormaAST): LegalNormCatalogDevice[] => {
  const devices: LegalNormCatalogDevice[] = [];

  const visit = (node: UnknownNode, ancestors: LegalReferencePoint): void => {
    const type = node['tipo'];
    const next: Record<string, string> = { ...ancestors } as Record<string, string>;
    if (type === 'artigo' && typeof node['numero'] === 'string') {
      next['artigo'] = normalizeDesignator(node['numero']);
    } else if (type === 'paragrafo' && typeof node['numero'] === 'string') {
      next['paragrafo'] = normalizeParagraph(node['numero']);
    } else if (type === 'inciso' && typeof node['numero'] === 'string') {
      next['inciso'] = normalizeDesignator(node['numero']).toUpperCase();
    } else if (type === 'alinea' && typeof node['letra'] === 'string') {
      next['alinea'] = node['letra'].trim().toLocaleLowerCase('pt-BR');
    } else if (type === 'item' && typeof node['numero'] === 'string') {
      next['item'] = normalizeDesignator(node['numero']);
    }

    const blockId = node['blockId'];
    if (
      typeof blockId === 'string' &&
      ['artigo', 'paragrafo', 'inciso', 'alinea', 'item'].includes(String(type))
    ) {
      devices.push({ blockId, point: legalReferencePointSchema.parse(next) });
    }

    const children = node['children'];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
          visit(child as UnknownNode, next);
        }
      }
    }
  };

  visit(ast as unknown as UnknownNode, {});
  return devices.sort((left, right) => left.blockId.localeCompare(right.blockId, 'en'));
};

const normTypeLabel: Readonly<Record<LegalNormIdentity['tipoNorma'], string>> = {
  'lei ordinária': 'Lei',
  'lei complementar': 'Lei Complementar',
  'decreto-lei': 'Decreto-Lei',
  decreto: 'Decreto',
  'medida provisória': 'Medida Provisória',
  'emenda constitucional': 'Emenda Constitucional',
  código: 'Código',
  constituição: 'Constituição',
};

const aliasesFor = (
  ast: IdentifiedNormaAST,
  explicitAliases: readonly string[],
): LegalNormCatalogAlias[] => {
  const label = normTypeLabel[ast.tipoNorma];
  const candidates = [
    ast.titulo,
    ast.sigla,
    ...explicitAliases,
    `${label} ${ast.numero}/${String(ast.ano)}`,
    `${label} nº ${ast.numero}/${String(ast.ano)}`,
  ];
  const byNormalized = new Map<string, LegalNormCatalogAlias>();
  for (const display of candidates) {
    const normalized = normalizeLegalNormAlias(display);
    if (normalized.length > 0 && !byNormalized.has(normalized)) {
      byNormalized.set(normalized, { display: display.trim(), normalized });
    }
  }
  return [...byNormalized.values()].sort((left, right) =>
    left.normalized.localeCompare(right.normalized, 'en'),
  );
};

export const createCatalogEntry = (
  ast: IdentifiedNormaAST,
  revisionHash: string,
  aliases: readonly string[] = [],
): LegalNormCatalogEntry => ({
  canonicalKey: legalNormIdentityKey(identityFromAst(ast)),
  law: identityFromAst(ast),
  revisionHash: revisionHashSchema.parse(revisionHash),
  title: ast.titulo,
  acronym: ast.sigla,
  aliases: aliasesFor(ast, aliases),
  devices: catalogDevicesFromAst(ast),
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

/** Cria uma fotografia determinística do catálogo local a partir das revisões importadas. */
export const createLegalNormCatalog = (
  inputs: readonly LegalNormCatalogInput[],
  options: CreateLegalNormCatalogOptions,
): ResultadoValidacao<Readonly<LegalNormCatalog>> => {
  const entries: LegalNormCatalogEntry[] = [];
  const identities = new Set<string>();

  for (const [index, input] of inputs.entries()) {
    const validation = validarIdentifiedNormaAst(input.ast);
    if (!validation.ok) return validation;
    const identity = identityFromAst(validation.valor);
    const canonicalKey = legalNormIdentityKey(identity);
    if (identities.has(canonicalKey)) {
      return falha([
        criarProblema(
          'catalogo_juridico_invalido',
          ['entries', index],
          `A identidade ${canonicalKey} já possui uma revisão selecionada no catálogo.`,
        ),
      ]);
    }
    identities.add(canonicalKey);

    const aliases = input.aliases ?? [];
    if (
      !Array.isArray(aliases) ||
      aliases.length > 500 ||
      aliases.some((alias) => typeof alias !== 'string' || alias.trim().length === 0)
    ) {
      return falha([
        criarProblema(
          'catalogo_juridico_invalido',
          ['entries', index, 'aliases'],
          'Aliases adicionais devem ser uma lista de até 500 textos não vazios.',
        ),
      ]);
    }

    let revisionHash: string;
    try {
      revisionHash = calculateRevisionHash(validation.valor, options.sha256);
      entries.push(createCatalogEntry(validation.valor, revisionHash, aliases));
    } catch {
      return falha([
        criarProblema(
          'catalogo_juridico_invalido',
          ['entries', index, 'revisionHash'],
          'Não foi possível calcular um hash SHA-256 válido para a revisão catalogada.',
        ),
      ]);
    }
  }

  entries.sort((left, right) =>
    left.canonicalKey < right.canonicalKey ? -1 : left.canonicalKey > right.canonicalKey ? 1 : 0,
  );
  const keysByAlias = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const keys = keysByAlias.get(alias.normalized) ?? new Set<string>();
      keys.add(entry.canonicalKey);
      keysByAlias.set(alias.normalized, keys);
    }
  }
  const collisions = [...keysByAlias.entries()]
    .filter(([, keys]) => keys.size > 1)
    .map(([normalizedAlias, keys]) => ({
      normalizedAlias,
      canonicalKeys: [...keys].sort((left, right) => left.localeCompare(right, 'en')),
    }))
    .sort((left, right) => left.normalizedAlias.localeCompare(right.normalizedAlias, 'en'));

  try {
    return sucesso(
      deepFreeze(legalNormCatalogSchema.parse({ schemaVersion: 1, entries, collisions })),
    );
  } catch (error) {
    return falha(
      error instanceof zod.ZodError
        ? problemasDoZod(error)
        : [
            criarProblema(
              'catalogo_juridico_invalido',
              ['entries'],
              'O catálogo não satisfaz seu contrato runtime.',
            ),
          ],
    );
  }
};
