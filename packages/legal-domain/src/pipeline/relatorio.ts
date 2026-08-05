// Contratos entre estágios do pipeline e relatório estruturado.
//
// A RF-003-05 exige que o erro aponte etapa, nó/fragmento e motivo. Sem uma
// etapa nomeada no problema, um erro de parsing e um erro de formatação
// chegariam ao operador com a mesma cara, e a CLI não teria como devolver
// código de saída distinto — que é o que o `plan.md` pede.
//
// O diagnóstico textual deriva dos códigos, nunca o contrário.

import type { ProblemaValidacao } from '../ast/errors.js';

/**
 * Estágios do corte vertical, na ordem em que executam. A ordem importa: a CLI
 * usa o índice para escolher o código de saída, e um relatório sempre para no
 * primeiro estágio que falha — RF-003-02 proíbe que um estágio receba
 * estrutura parcial do anterior.
 */
export const ETAPAS = [
  'entrada',
  'parsing',
  'identificacao',
  'validacao',
  'formatacao',
  'escrita',
] as const;

export type Etapa = (typeof ETAPAS)[number];

/** Um problema situado no estágio que o produziu. */
export interface ProblemaDeEtapa extends ProblemaValidacao {
  readonly etapa: Etapa;
}

export interface MetricasDoPipeline {
  readonly linhasLidas: number;
  readonly artigos: number;
  readonly dispositivos: number;
  readonly blockIdsAtribuidos: number;
  readonly dispositivosRevogados: number;
  readonly nosExigindoRevisaoHumana: number;
}

export type Relatorio =
  | {
      readonly ok: true;
      readonly etapaFinal: Etapa;
      readonly metricas: MetricasDoPipeline;
      readonly problemas: readonly ProblemaDeEtapa[];
    }
  | {
      readonly ok: false;
      /** Estágio em que o pipeline parou. */
      readonly etapaFinal: Etapa;
      readonly problemas: readonly ProblemaDeEtapa[];
    };

export const situarProblemas = (
  etapa: Etapa,
  problemas: readonly ProblemaValidacao[],
): readonly ProblemaDeEtapa[] => problemas.map((problema) => ({ ...problema, etapa }));

/**
 * Renderiza o relatório para leitura humana. É apresentação derivada dos
 * códigos: quem automatiza decide por `codigo` e `etapa`, não por este texto.
 */
export const descreverRelatorio = (relatorio: Relatorio): string => {
  if (relatorio.ok) {
    const m = relatorio.metricas;

    return [
      `ok — etapa final: ${relatorio.etapaFinal}`,
      `linhas lidas: ${String(m.linhasLidas)}`,
      `artigos: ${String(m.artigos)}`,
      `dispositivos: ${String(m.dispositivos)}`,
      `Block IDs atribuídos: ${String(m.blockIdsAtribuidos)}`,
      `dispositivos revogados: ${String(m.dispositivosRevogados)}`,
      `nós exigindo revisão humana: ${String(m.nosExigindoRevisaoHumana)}`,
    ].join('\n');
  }

  const linhas = relatorio.problemas.map((problema) => {
    const caminho = problema.caminho.length > 0 ? `/${problema.caminho.join('/')}` : '(raiz)';
    const no = problema.noId === undefined ? '' : ` [nó ${problema.noId}]`;

    return `  ${problema.etapa}: ${problema.codigo} em ${caminho}${no}\n    ${problema.mensagem}`;
  });

  return [
    `falhou na etapa "${relatorio.etapaFinal}" com ${String(relatorio.problemas.length)} problema(s):`,
    ...linhas,
  ].join('\n');
};
