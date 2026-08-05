// Atribuição inicial de Block IDs (BLOCK_ID_SPEC.md §8).
//
// Primeira publicação apenas: não há registro histórico a reconciliar, o que a
// Feature 003 declara fora de escopo. O que existe aqui é a geração canônica e
// a recusa de colisão.
//
// A política de falha da §7.3 é explícita: colisão é bloqueante e **não** há
// resolução silenciosa por contador. Sufixar `-2` num ID colidido produziria um
// link estável apontando para o dispositivo errado, que é pior do que falhar.
// A única resolução automática permitida é qualificação estrutural por divisão,
// e a fixture desta feature não tem divisões — então aqui a colisão só falha.

import {
  criarProblema,
  falha,
  type ProblemaValidacao,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { IdentifiedNormaAST, ParsedNormaAST } from '../ast/nodes.js';

const ROMANOS = /^[ivxlcdm]+$/u;

/** "121-A" → "121-a"; "121" → "121" (BLOCK_ID_SPEC §8.2). */
const normalizarNumeroArtigo = (bruto: string): string =>
  bruto.trim().toLowerCase().replace(/\s+/gu, '');

/** "único"/"unico" → "unico"; "1º" → "1". */
const normalizarParagrafo = (bruto: string): string => {
  const valor = bruto.trim().toLowerCase();

  if (valor === 'único' || valor === 'unico') {
    return 'unico';
  }

  return valor.replace(/\D/gu, '');
};

const normalizarLetra = (bruto: string): string =>
  bruto
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/gu, '');

const normalizarCardinal = (bruto: string): string => bruto.trim().replace(/\D/gu, '');

type Segmento =
  { readonly ok: true; readonly valor: string } | { readonly ok: false; readonly motivo: string };

/** Segmento do ID para um nó, conforme a gramática da §2.1. */
const segmentoDe = (no: Record<string, unknown>): Segmento => {
  const tipo = no['tipo'];
  const numero = typeof no['numero'] === 'string' ? no['numero'] : '';

  switch (tipo) {
    case 'artigo': {
      const valor = normalizarNumeroArtigo(numero);

      return valor.length > 0
        ? { ok: true, valor: `art-${valor}` }
        : { ok: false, motivo: 'artigo sem número' };
    }
    case 'paragrafo': {
      const valor = normalizarParagrafo(numero);

      return valor.length > 0
        ? { ok: true, valor: `par-${valor}` }
        : { ok: false, motivo: `número de parágrafo inválido: ${JSON.stringify(numero)}` };
    }
    case 'inciso': {
      // §2.3 regra 7: inciso é romano minúsculo, nunca arábico.
      const valor = numero.trim().toLowerCase();

      return ROMANOS.test(valor)
        ? { ok: true, valor: `inc-${valor}` }
        : { ok: false, motivo: `numeral romano inválido: ${JSON.stringify(numero)}` };
    }
    case 'alinea': {
      const letra = typeof no['letra'] === 'string' ? normalizarLetra(no['letra']) : '';

      return letra.length > 0
        ? { ok: true, valor: `ali-${letra}` }
        : { ok: false, motivo: 'alínea sem letra' };
    }
    case 'item': {
      const valor = normalizarCardinal(numero);

      return valor.length > 0
        ? { ok: true, valor: `item-${valor}` }
        : { ok: false, motivo: 'item sem número' };
    }
    case 'pena': {
      // §2.3 regra 12: só numera quando a fonte traz ordem jurídica explícita.
      // O gerador nunca inventa numeração pela ordem de parsing.
      const valor = normalizarCardinal(numero);

      return { ok: true, valor: valor.length > 0 ? `pena-${valor}` : 'pena' };
    }
    case 'anexo': {
      const valor = numero.normalize('NFD').replace(/[̀-ͯ]/gu, '').trim().toLowerCase();

      return valor.length > 0
        ? { ok: true, valor: `anx-${valor}` }
        : { ok: false, motivo: 'anexo sem número' };
    }
    case 'tabela': {
      const valor = normalizarCardinal(numero);

      return valor.length > 0
        ? { ok: true, valor: `tab-${valor}` }
        : { ok: false, motivo: 'tabela sem número' };
    }
    default:
      return { ok: false, motivo: `tipo sem segmento de Block ID: ${String(tipo)}` };
  }
};

const REFERENCIAVEIS = new Set([
  'artigo',
  'paragrafo',
  'inciso',
  'alinea',
  'item',
  'pena',
  'anexo',
  'tabela',
]);

const DIVISOES = new Set(['livro', 'titulo', 'capitulo', 'secao', 'subsecao']);

/**
 * Percorre a árvore `parsed` e devolve a `identified`, com Block ID em todo nó
 * referenciável. Não muta a entrada: o estágio anterior continua íntegro para
 * diagnóstico.
 */
export const identificar = (
  arvore: ParsedNormaAST,
  sigla: string,
): ResultadoValidacao<IdentifiedNormaAST> => {
  const problemas: ProblemaValidacao[] = [];
  const emitidos = new Map<string, readonly (string | number)[]>();

  const visitar = (
    no: Record<string, unknown>,
    prefixo: readonly string[],
    caminho: readonly (string | number)[],
  ): Record<string, unknown> => {
    const tipo = typeof no['tipo'] === 'string' ? no['tipo'] : '';
    const filhos = Array.isArray(no['children'])
      ? (no['children'] as Record<string, unknown>[])
      : [];

    // Divisões não entram no ID por padrão (§2.4) e não recebem ID próprio.
    if (DIVISOES.has(tipo)) {
      return {
        ...no,
        children: filhos.map((filho, i) => visitar(filho, prefixo, [...caminho, 'children', i])),
      };
    }

    if (!REFERENCIAVEIS.has(tipo)) {
      return {
        ...no,
        children: filhos.map((filho, i) => visitar(filho, prefixo, [...caminho, 'children', i])),
      };
    }

    const segmento = segmentoDe(no);

    if (!segmento.ok) {
      problemas.push(
        criarProblema(
          'block_id_nao_canonico',
          caminho,
          segmento.motivo,
          typeof no['id'] === 'string' ? no['id'] : undefined,
        ),
      );

      return {
        ...no,
        children: filhos.map((filho, i) => visitar(filho, prefixo, [...caminho, 'children', i])),
      };
    }

    const cadeia = [...prefixo, segmento.valor];
    const blockId = cadeia.join('-');
    const anterior = emitidos.get(blockId);

    if (anterior === undefined) {
      emitidos.set(blockId, caminho);
    } else {
      problemas.push(
        criarProblema(
          'block_id_duplicado',
          [...caminho, 'blockId'],
          `O Block ID "${blockId}" colidiu com o de /${anterior.join('/')}. A resolução por contador é proibida (BLOCK_ID_SPEC §7.3).`,
          typeof no['id'] === 'string' ? no['id'] : undefined,
        ),
      );
    }

    return {
      ...no,
      blockId,
      children: filhos.map((filho, i) => visitar(filho, cadeia, [...caminho, 'children', i])),
    };
  };

  const siglaNormalizada = sigla.trim().toLowerCase();

  if (!/^[a-z][a-z0-9-]*$/u.test(siglaNormalizada)) {
    return falha([
      criarProblema(
        'block_id_nao_canonico',
        ['sigla'],
        `Sigla fora da gramática: ${JSON.stringify(sigla)}.`,
      ),
    ]);
  }

  const raizComoRegistro = arvore as unknown as Record<string, unknown>;
  const filhos = Array.isArray(raizComoRegistro['children'])
    ? (raizComoRegistro['children'] as Record<string, unknown>[])
    : [];

  const identificada = {
    ...raizComoRegistro,
    astPhase: 'identified',
    children: filhos.map((filho, i) => visitar(filho, [siglaNormalizada], ['children', i])),
  };

  if (problemas.length > 0) {
    return falha(problemas);
  }

  return sucesso(identificada as unknown as IdentifiedNormaAST);
};

/** Quantos Block IDs uma árvore identificada carrega. Usado no relatório. */
export const contarBlockIds = (arvore: IdentifiedNormaAST): number => {
  let total = 0;

  const visitar = (no: Record<string, unknown>): void => {
    if (typeof no['blockId'] === 'string') {
      total += 1;
    }

    const filhos = Array.isArray(no['children'])
      ? (no['children'] as Record<string, unknown>[])
      : [];

    for (const filho of filhos) {
      visitar(filho);
    }
  };

  visitar(arvore as unknown as Record<string, unknown>);

  return total;
};
