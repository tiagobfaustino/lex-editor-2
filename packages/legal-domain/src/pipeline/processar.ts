// Composição dos estágios: texto → ParsedNormaAST → IdentifiedNormaAST →
// validação → Markdown.
//
// Mora no domínio, e não na CLI, porque nada aqui toca filesystem, rede ou
// relógio. A CLI fica com o que é mesmo dela: ler arquivo, calcular hash,
// escrever de forma atômica e traduzir etapa em código de saída.
//
// A RF-003-02 exige que cada estágio valide sua entrada e não receba estrutura
// parcial. Por isso o pipeline para no primeiro estágio que falha e devolve o
// relatório daquele ponto, em vez de seguir com uma árvore meio construída.

import { contarBlockIds, identificar } from '../block-id/index.js';
import { formatar } from '../formatter/index.js';
import { analisar, type EntradaDoParser } from '../parser/index.js';
import { percorrer, validarIdentifiedNormaAst } from '../ast/validate.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { type Relatorio, situarProblemas } from './relatorio.js';

export interface ResultadoDoPipeline {
  readonly relatorio: Relatorio;
  /** Presente somente quando o relatório é `ok`. */
  readonly markdown?: string;
  readonly arvore?: IdentifiedNormaAST;
}

const contar = (
  arvore: IdentifiedNormaAST,
): { dispositivos: number; revogados: number; revisao: number; artigos: number } => {
  let dispositivos = 0;
  let revogados = 0;
  let revisao = 0;
  let artigos = 0;

  percorrer(
    arvore,
    ({ no }) => {
      if (no['tipo'] === 'lei') {
        const evidencia = no['parseEvidence'];

        if (
          typeof evidencia === 'object' &&
          evidencia !== null &&
          (evidencia as { requiresHumanReview?: unknown }).requiresHumanReview === true
        ) {
          revisao += 1;
        }

        return;
      }

      dispositivos += 1;

      if (no['tipo'] === 'artigo') {
        artigos += 1;
      }

      if (no['deviceStatus'] === 'revoked') {
        revogados += 1;
      }

      const evidencia = no['parseEvidence'];

      if (
        typeof evidencia === 'object' &&
        evidencia !== null &&
        (evidencia as { requiresHumanReview?: unknown }).requiresHumanReview === true
      ) {
        revisao += 1;
      }
    },
    () => {
      // Ciclo já teria sido recusado pela validação estrutural.
    },
  );

  return { dispositivos, revogados, revisao, artigos };
};

export const processar = (entrada: EntradaDoParser): ResultadoDoPipeline => {
  const linhasLidas = entrada.conteudo.split('\n').length;

  // --- parsing ---
  const analisada = analisar(entrada);

  if (!analisada.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'parsing',
        problemas: situarProblemas('parsing', analisada.problemas),
      },
    };
  }

  // --- identificação ---
  const identificada = identificar(analisada.valor, entrada.metadados.sigla);

  if (!identificada.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'identificacao',
        problemas: situarProblemas('identificacao', identificada.problemas),
      },
    };
  }

  // --- validação ---
  const validada = validarIdentifiedNormaAst(identificada.valor);

  if (!validada.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'validacao',
        problemas: situarProblemas('validacao', validada.problemas),
      },
    };
  }

  // --- formatação ---
  const markdown = formatar(validada.valor);

  if (!markdown.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'formatacao',
        problemas: situarProblemas('formatacao', markdown.problemas),
      },
    };
  }

  const contagens = contar(validada.valor);

  return {
    markdown: markdown.valor,
    arvore: validada.valor,
    relatorio: {
      ok: true,
      etapaFinal: 'formatacao',
      problemas: [],
      metricas: {
        linhasLidas,
        artigos: contagens.artigos,
        dispositivos: contagens.dispositivos,
        blockIdsAtribuidos: contarBlockIds(validada.valor),
        dispositivosRevogados: contagens.revogados,
        nosExigindoRevisaoHumana: contagens.revisao,
      },
    },
  };
};
