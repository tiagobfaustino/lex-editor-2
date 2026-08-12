// Projeções de apresentação da NormaAST (ADR-012).
//
// A árvore completa é a única fonte de verdade. Este módulo somente produz uma
// cópia derivada para preview/exportação: nunca altera a revisão autoritativa,
// não atribui Block IDs e não transforma redações históricas em nós próprios.

import { z } from 'zod';

import { TIPOS_DIVISAO } from '../ast/enums.js';
import {
  criarProblema,
  falha,
  type ProblemaValidacao,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { percorrer, validarIdentifiedNormaAst } from '../ast/validate.js';

export const contentProjectionProfileSchema = z.enum(['complete_with_history', 'current_only']);

export type ContentProjectionProfile = z.infer<typeof contentProjectionProfileSchema>;

export interface ContentProjection {
  readonly profile: ContentProjectionProfile;
  readonly ast: IdentifiedNormaAST;
}

type MutableNode = Record<string, unknown> & { children: MutableNode[] };

const ESTADOS_SEM_EFICACIA = new Set(['revoked', 'vetoed', 'suspended']);
const DIVISOES = new Set<string>(TIPOS_DIVISAO);

const ehNo = (valor: unknown): valor is MutableNode =>
  typeof valor === 'object' &&
  valor !== null &&
  !Array.isArray(valor) &&
  Array.isArray((valor as Record<string, unknown>)['children']);

const clonarValor = (valor: unknown): unknown => {
  if (Array.isArray(valor)) return valor.map((item) => clonarValor(item));
  if (typeof valor !== 'object' || valor === null) return valor;

  const copia: Record<string, unknown> = {};
  for (const [chave, item] of Object.entries(valor)) copia[chave] = clonarValor(item);
  return copia;
};

const contarArtigos = (raiz: unknown): number => {
  let total = 0;
  percorrer(
    raiz,
    ({ no }) => {
      if (no['tipo'] === 'artigo') total += 1;
    },
    () => undefined,
  );
  return total;
};

const localizarEstadosDesconhecidos = (ast: IdentifiedNormaAST): readonly ProblemaValidacao[] => {
  const problemas: ProblemaValidacao[] = [];

  percorrer(
    ast,
    ({ no, caminho }) => {
      if (no['deviceStatus'] !== 'unknown') return;

      const noId = typeof no['id'] === 'string' ? no['id'] : undefined;
      const blockId = typeof no['blockId'] === 'string' ? no['blockId'] : undefined;
      problemas.push(
        criarProblema(
          'estado_desconhecido_bloqueia_vigente',
          [...caminho, 'deviceStatus'],
          blockId === undefined
            ? 'O estado deste nó precisa de decisão editorial antes da projeção somente vigente.'
            : `O estado do dispositivo ${blockId} precisa de decisão editorial antes da projeção somente vigente.`,
          noId,
          blockId,
        ),
      );
    },
    () => undefined,
  );

  return Object.freeze(problemas);
};

/**
 * Filtra uma cópia já validada. `null` representa uma subárvore sem eficácia
 * ou uma divisão que ficou vazia. A redação histórica sai do nó mantido, mas o
 * Block ID canônico permanece exatamente como veio da revisão autoritativa.
 */
const projetarNoVigente = (no: MutableNode): MutableNode | null => {
  if (ESTADOS_SEM_EFICACIA.has(String(no['deviceStatus']))) return null;

  const children = no.children
    .map((filho) => projetarNoVigente(filho))
    .filter((filho): filho is MutableNode => filho !== null);

  if (DIVISOES.has(String(no['tipo'])) && children.length === 0) return null;

  const projetado: MutableNode = { ...no, children };
  delete projetado['redacoesAnteriores'];
  return projetado;
};

const perfilInvalido = (): ResultadoValidacao<ContentProjection> =>
  falha([
    criarProblema(
      'schema_invalido',
      ['profile'],
      'O perfil precisa ser "complete_with_history" ou "current_only".',
    ),
  ]);

/**
 * Produz uma projeção determinística da mesma revisão identificada.
 *
 * O parâmetro aceita `unknown` intencionalmente: ele cruza contratos IPC e de
 * persistência nas próximas tarefas e, por isso, também é validado em runtime.
 */
export const projectContent = (
  entrada: unknown,
  profile: unknown = 'complete_with_history',
): ResultadoValidacao<ContentProjection> => {
  const perfil = contentProjectionProfileSchema.safeParse(profile);
  if (!perfil.success) return perfilInvalido();

  const validado = validarIdentifiedNormaAst(entrada);
  if (!validado.ok) return validado;

  if (perfil.data === 'complete_with_history') {
    return sucesso({
      profile: perfil.data,
      ast: clonarValor(validado.valor) as IdentifiedNormaAST,
    });
  }

  const desconhecidos = localizarEstadosDesconhecidos(validado.valor);
  if (desconhecidos.length > 0) return falha(desconhecidos);

  const copia = clonarValor(validado.valor);
  if (!ehNo(copia)) {
    return falha([criarProblema('schema_invalido', [], 'A raiz projetada deixou de ser um nó.')]);
  }

  copia.children = copia.children
    .map((filho) => projetarNoVigente(filho))
    .filter((filho): filho is MutableNode => filho !== null);
  copia['totalArtigos'] = contarArtigos(copia);

  const projecaoValidada = validarIdentifiedNormaAst(copia);
  if (!projecaoValidada.ok) return projecaoValidada;

  return sucesso({ profile: perfil.data, ast: projecaoValidada.valor });
};
