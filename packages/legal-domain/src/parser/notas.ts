// Notas oficiais que determinam o estado do dispositivo (T004-03).
//
// O Planalto anota o dispositivo com um parentético ao final: `(Revogado pela
// Lei nº X)`, `(Incluído pela Lei nº Y)`, `(Redação dada pela Lei nº Z)`. A
// `MARKDOWN_SPEC.md` §5.4 e a ADR-006 §3 dizem o que cada forma significa, e a
// ADR-005 dá o `deviceStatus` correspondente.
//
// Extrair a nota para um campo não é alterar o texto jurídico: é o que o
// DATA_MODEL manda fazer com ela. O texto normativo continua literal; o que sai
// dele é a anotação editorial da fonte, que tem campo próprio. Só um
// parentético que casa exatamente com uma das formas conhecidas é extraído —
// qualquer outro fica no texto, onde estava.

import type { DeviceStatus } from '../ast/enums.js';

export interface NotaDeEstado {
  /** Texto sem o parentético extraído. */
  readonly texto: string;
  readonly deviceStatus: DeviceStatus;
  readonly notaStatus?: string;
  readonly preservarTextoRevogado?: boolean;
  readonly redacaoAtualDadaPor?: string;
}

/** Estados sem eficácia prevalecem mesmo quando outra anotação vem depois. */
const NOTA_SEM_EFICACIA = /\((?:Revogad|Vetad|Suspens)[^)]*\)/giu;

/** As demais notas só são extraídas quando encerram a linha, como no contrato original. */
const NOTA_FINAL = /\s*(\((?:Inclu|Reda[çc]|Renumerad)[^)]*\))\s*$/iu;

const REVOGACAO = /^\(Revogad/iu;
const VETO = /^\(Vetad/iu;
const INCLUSAO = /^\(Inclu/iu;
const REDACAO = /^\(Reda[çc]/iu;
const RENUMERACAO = /^\(Renumerad/iu;

/** Conteúdo do parentético sem os delimitadores, para `notaStatus`. */
const semParenteses = (nota: string): string => nota.replace(/^\(|\)$/gu, '').trim();

/**
 * Interpreta a linha de um dispositivo e devolve texto, estado e campos
 * derivados da nota.
 *
 * `riscado` diz se a linha vinha entre `~~`. É ele que separa os dois casos que
 * a §5.5 distingue: riscado **com** designador é dispositivo revogado cujo
 * texto foi preservado; riscado **sem** Block ID é redação anterior, e isso é
 * tratado antes, no percurso do parser.
 */
export const interpretarNota = (bruto: string, riscado: boolean): NotaDeEstado => {
  const semEficacia = [...bruto.matchAll(NOTA_SEM_EFICACIA)]
    .map((match) => match[0])
    .sort((a, b) => {
      const prioridade = (nota: string): number =>
        REVOGACAO.test(nota) ? 0 : VETO.test(nota) ? 1 : 2;
      return prioridade(a) - prioridade(b);
    })[0];

  if (semEficacia !== undefined) {
    if (REVOGACAO.test(semEficacia)) {
      return riscado
        ? {
            texto: bruto.replace(semEficacia, '').replace(/\s+/gu, ' ').trim(),
            deviceStatus: 'revoked',
            preservarTextoRevogado: true,
            notaStatus: semParenteses(semEficacia),
          }
        : {
            texto: bruto.trim(),
            deviceStatus: 'revoked',
            preservarTextoRevogado: false,
            notaStatus: semParenteses(semEficacia),
          };
    }

    if (VETO.test(semEficacia)) {
      return {
        texto: bruto.trim(),
        deviceStatus: 'vetoed',
        notaStatus: semParenteses(semEficacia),
      };
    }

    return {
      texto: bruto.trim(),
      deviceStatus: 'suspended',
      notaStatus: semParenteses(semEficacia),
    };
  }

  const casamento = NOTA_FINAL.exec(bruto);
  const nota = casamento?.[1];
  const texto = casamento === null ? bruto.trim() : bruto.slice(0, casamento.index).trim();

  if (nota === undefined) {
    // Sem nota: o dispositivo é ativo, salvo se estiver riscado — riscado sem
    // nota alguma é marcação incompleta, que a §5.4 declara inválida e que o
    // validador estrutural recusa por falta de `notaStatus`.
    return riscado
      ? { texto, deviceStatus: 'revoked', preservarTextoRevogado: true }
      : { texto, deviceStatus: 'active' };
  }

  if (RENUMERACAO.test(nota)) {
    return { texto, deviceStatus: 'renumbered', notaStatus: semParenteses(nota) };
  }

  if (INCLUSAO.test(nota)) {
    return { texto, deviceStatus: 'included', redacaoAtualDadaPor: semParenteses(nota) };
  }

  if (REDACAO.test(nota)) {
    // ADR-006 §3: a nota de redação marca alteração; o dispositivo está
    // vigente com a redação atual, e a norma que a conferiu vira campo.
    return { texto, deviceStatus: 'amended', redacaoAtualDadaPor: semParenteses(nota) };
  }

  return { texto: bruto.trim(), deviceStatus: 'active' };
};

/** Linha de redação anterior: riscada e sem Block ID (ADR-006 §2). */
const LINHA_RISCADA = /^~~(.+?)~~\s*(?:\*\(([^)]*)\)\*|\(([^)]*)\))?\s*$/u;

export interface RedacaoAnteriorBruta {
  readonly texto: string;
  readonly nota?: string | undefined;
}

/**
 * Reconhece uma linha de histórico. A §5.5 manda acumular as riscadas sem
 * Block ID e anexá-las ao próximo dispositivo — elas são apresentação, não
 * posição referenciável.
 */
export const lerLinhaRiscada = (linha: string): RedacaoAnteriorBruta | undefined => {
  const casamento = LINHA_RISCADA.exec(linha.trim());

  if (casamento === null) {
    return undefined;
  }

  const nota = (casamento[2] ?? casamento[3] ?? '').trim();
  return {
    texto: (casamento[1] ?? '').trim(),
    ...(nota.length > 0 ? { nota } : {}),
  };
};
