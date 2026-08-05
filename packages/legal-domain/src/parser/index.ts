// Parser mínimo do subconjunto da Feature 003.
//
// Reconhece apenas os designadores presentes na fixture — o `plan.md` proíbe
// generalizar padrões que ela não sustenta. Cada padrão suportado está na
// tabela DESIGNADORES abaixo; uma linha que não casa com nenhum deles é erro,
// nunca texto solto anexado ao dispositivo anterior. Anexar silenciosamente
// alteraria conteúdo jurídico, que é o pior sucesso falso possível aqui.
//
// A hierarquia vem do tipo do designador, não de indentação: o texto oficial é
// plano. Cada designador declara quem pode ser seu pai; sem um pai aberto e
// compatível, o dispositivo é órfão e o parsing falha.

import {
  criarProblema,
  falha,
  type ProblemaValidacao,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type {
  ParsedNormaAST,
  ParseEvidence,
  SlotSemBlockId,
  SourceReference,
} from '../ast/nodes.js';

/** Tipos que o parser desta feature sabe produzir. */
type TipoSuportado = 'artigo' | 'paragrafo' | 'inciso' | 'alinea' | 'pena';

interface Designador {
  readonly tipo: TipoSuportado;
  readonly padrao: RegExp;
  /** Tipos que podem receber este dispositivo como filho, do mais próximo ao mais distante. */
  readonly paisPossiveis: readonly TipoSuportado[];
  /** Extrai o número/letra bruto e o texto do dispositivo. */
  readonly extrair: (casamento: RegExpMatchArray) => { numero: string; texto: string };
}

/**
 * Ordem importa: `padrao` é testado de cima para baixo, e o primeiro que casa
 * vence. `Pena` vem antes de alínea porque "Pena - ..." casaria com nada, mas
 * manter a intenção explícita evita surpresa quando a tabela crescer.
 */
const DESIGNADORES: readonly Designador[] = [
  {
    tipo: 'artigo',
    // "Art. 121." e "Art. 121-A." — o sufixo alfabético é parte do número.
    padrao: /^Art\.\s*(\d+(?:-[A-Za-z])?)\s*[.º°]?\s*(.*)$/u,
    paisPossiveis: [],
    extrair: (m) => ({ numero: m[1] ?? '', texto: m[2] ?? '' }),
  },
  {
    tipo: 'pena',
    padrao: /^Pena\s*[-–—]\s*(.*)$/u,
    paisPossiveis: ['alinea', 'inciso', 'paragrafo', 'artigo'],
    extrair: (m) => ({ numero: '', texto: `Pena - ${m[1] ?? ''}` }),
  },
  {
    tipo: 'paragrafo',
    padrao: /^Parágrafo\s+único\.\s*(.*)$/u,
    paisPossiveis: ['artigo'],
    extrair: (m) => ({ numero: 'unico', texto: m[1] ?? '' }),
  },
  {
    tipo: 'paragrafo',
    padrao: /^§\s*(\d+)\s*[º°]?\s*(.*)$/u,
    paisPossiveis: ['artigo'],
    extrair: (m) => ({ numero: m[1] ?? '', texto: m[2] ?? '' }),
  },
  {
    tipo: 'inciso',
    padrao: /^([IVXLCDM]+)\s*[-–—]\s*(.*)$/u,
    paisPossiveis: ['paragrafo', 'artigo'],
    extrair: (m) => ({ numero: m[1] ?? '', texto: m[2] ?? '' }),
  },
  {
    tipo: 'alinea',
    padrao: /^([a-z])\)\s*(.*)$/u,
    paisPossiveis: ['inciso'],
    extrair: (m) => ({ numero: m[1] ?? '', texto: m[2] ?? '' }),
  },
];

/** Texto residual oficial de revogação, ex.: "(Revogado pela Lei nº 14.994, de 2024)". */
const REVOGACAO = /^\(Revogad[oa][^)]*\)$/u;
const VETO = /^\(Vetad[oa][^)]*\)$/u;

interface NoEmConstrucao {
  readonly tipo: TipoSuportado;
  readonly numero: string;
  readonly texto: string;
  readonly linha: number;
  readonly filhos: NoEmConstrucao[];
  readonly revogado: boolean;
  readonly vetado: boolean;
}

export interface EntradaDoParser {
  readonly conteudo: string;
  readonly referenciaBase: SourceReference;
  /** Hash de cada linha, para que `fragmentSha256` aponte para o fragmento real. */
  readonly hashDaLinha: (linha: string) => string;
  readonly metadados: MetadadosDaNorma;
}

export interface MetadadosDaNorma {
  readonly titulo: string;
  readonly sigla: string;
  readonly tipoNorma: ParsedNormaAST['tipoNorma'];
  readonly numero: string;
  readonly ano: number;
  readonly ramo: string;
  readonly fonte: string;
  readonly dataPublicacao: string;
  readonly dataAtualizacaoLegal: string;
  readonly dataFormatacaoVinculex: string;
  readonly dataVerificacaoIntegridade: string;
  readonly versaoVinculex: string;
  readonly legalStatus: ParsedNormaAST['legalStatus'];
  readonly publicationStatus: ParsedNormaAST['publicationStatus'];
  readonly tags?: readonly string[] | undefined;
  readonly notasEditoriais?: readonly string[] | undefined;
}

const reconhecer = (
  linha: string,
): { designador: Designador; numero: string; texto: string } | undefined => {
  for (const designador of DESIGNADORES) {
    const casamento = designador.padrao.exec(linha);

    if (casamento !== null) {
      const { numero, texto } = designador.extrair(casamento);

      return { designador, numero, texto };
    }
  }

  return undefined;
};

/**
 * Evidência do reconhecimento. Um designador que casou exatamente é
 * `exact_legal_designator` com confiança alta; a pena, cuja ancoragem depende
 * do dispositivo anterior e não de marcação própria, é
 * `hierarchy_inferred_from_context`. Distinguir os dois é o que permite a um
 * revisor saber onde olhar primeiro.
 */
const evidenciaDe = (tipo: TipoSuportado): ParseEvidence =>
  tipo === 'pena'
    ? {
        confidence: 'medium',
        reasons: ['exact_legal_designator', 'hierarchy_inferred_from_context'],
        requiresHumanReview: false,
      }
    : { confidence: 'high', reasons: ['exact_legal_designator'], requiresHumanReview: false };

/** Converte a árvore intermediária em nós da NormaAST na fase `parsed`. */
const materializar = (
  no: NoEmConstrucao,
  indice: number,
  entrada: EntradaDoParser,
  linhas: readonly string[],
): Record<string, unknown> => {
  const bruto = linhas[no.linha] ?? '';
  const sourceRef: SourceReference = {
    ...entrada.referenciaBase,
    rawStartLine: no.linha + 1,
    rawEndLine: no.linha + 1,
    fragmentSha256: entrada.hashDaLinha(bruto),
  };

  const comum = {
    id: `no-l${String(no.linha + 1)}`,
    ordem: indice,
    sourceRef,
    parseEvidence: evidenciaDe(no.tipo),
    children: no.filhos.map((filho, i) => materializar(filho, i, entrada, linhas)),
  };

  // MARKDOWN_SPEC §5.3: sem texto anterior preservado, o texto residual oficial
  // é reproduzido como está e a decisão editorial é `false`. O Formatter não
  // pode inferir isso; aqui ela vem da forma do próprio texto oficial.
  const estado = no.revogado
    ? { deviceStatus: 'revoked' as const, preservarTextoRevogado: false, notaStatus: no.texto }
    : no.vetado
      ? { deviceStatus: 'vetoed' as const, notaStatus: no.texto }
      : { deviceStatus: 'active' as const };

  switch (no.tipo) {
    case 'artigo':
      return { ...comum, ...estado, tipo: 'artigo', numero: no.numero, caput: no.texto };
    case 'paragrafo':
      return { ...comum, ...estado, tipo: 'paragrafo', numero: no.numero, texto: no.texto };
    case 'inciso':
      return { ...comum, ...estado, tipo: 'inciso', numero: no.numero, texto: no.texto };
    case 'alinea':
      return { ...comum, ...estado, tipo: 'alinea', letra: no.numero, texto: no.texto };
    case 'pena':
      return { ...comum, ...estado, tipo: 'pena', texto: no.texto, children: [] };
  }
};

/**
 * Analisa o texto e devolve uma `ParsedNormaAST` — sem Block ID em nó algum,
 * por definição da fase.
 */
export const analisar = (entrada: EntradaDoParser): ResultadoValidacao<ParsedNormaAST> => {
  const linhas = entrada.conteudo.split('\n');
  const problemas: ProblemaValidacao[] = [];
  const artigos: NoEmConstrucao[] = [];
  /** Pilha dos dispositivos abertos, do mais externo ao mais interno. */
  let abertos: NoEmConstrucao[] = [];

  if (entrada.conteudo.trim().length === 0) {
    return falha([criarProblema('entrada_vazia', [], 'A entrada não tem conteúdo.')]);
  }

  linhas.forEach((linhaBruta, indice) => {
    const linha = linhaBruta.trim();

    if (linha.length === 0) {
      return;
    }

    const reconhecido = reconhecer(linha);

    if (reconhecido === undefined) {
      problemas.push(
        criarProblema(
          'designador_desconhecido',
          ['linhas', indice + 1],
          `A linha ${String(indice + 1)} não corresponde a nenhum designador suportado: ${JSON.stringify(linha.slice(0, 60))}.`,
        ),
      );
      return;
    }

    const { designador, numero, texto } = reconhecido;

    const no: NoEmConstrucao = {
      tipo: designador.tipo,
      numero,
      texto,
      linha: indice,
      filhos: [],
      revogado: REVOGACAO.test(texto),
      vetado: VETO.test(texto),
    };

    if (designador.tipo === 'artigo') {
      artigos.push(no);
      abertos = [no];
      return;
    }

    // Desempilha até encontrar um pai que aceite este tipo. É aqui que o
    // inciso órfão é recusado: sem artigo aberto, não há a quem pertencer.
    // `findLastIndex` exigiria lib ES2023; o pacote está em ES2022 e a
    // baseline não muda por conveniência de um laço.
    let profundidade = -1;

    for (let i = abertos.length - 1; i >= 0; i -= 1) {
      const candidato = abertos[i];

      if (candidato !== undefined && designador.paisPossiveis.includes(candidato.tipo)) {
        profundidade = i;
        break;
      }
    }

    if (profundidade === -1) {
      problemas.push(
        criarProblema(
          'dispositivo_orfao',
          ['linhas', indice + 1],
          `"${designador.tipo}" na linha ${String(indice + 1)} não tem dispositivo pai; esperado um de: ${designador.paisPossiveis.join(', ')}.`,
        ),
      );
      return;
    }

    const pai = abertos[profundidade];

    if (pai === undefined) {
      return;
    }

    pai.filhos.push(no);
    abertos = [...abertos.slice(0, profundidade + 1), no];
  });

  if (problemas.length > 0) {
    return falha(problemas);
  }

  if (artigos.length === 0) {
    return falha([criarProblema('dispositivo_orfao', [], 'A entrada não contém nenhum artigo.')]);
  }

  const m = entrada.metadados;
  const raiz = {
    tipo: 'lei',
    astPhase: 'parsed',
    id: 'no-raiz',
    ordem: 0,
    sourceRef: entrada.referenciaBase,
    parseEvidence: {
      confidence: 'high',
      reasons: ['known_source_markup'],
      requiresHumanReview: false,
    },
    titulo: m.titulo,
    sigla: m.sigla,
    tipoNorma: m.tipoNorma,
    numero: m.numero,
    ano: m.ano,
    ramo: m.ramo,
    fonte: m.fonte,
    dataPublicacao: m.dataPublicacao,
    dataAtualizacaoLegal: m.dataAtualizacaoLegal,
    dataFormatacaoVinculex: m.dataFormatacaoVinculex,
    totalArtigos: artigos.length,
    versaoVinculex: m.versaoVinculex,
    legalStatus: m.legalStatus,
    publicationStatus: m.publicationStatus,
    dataVerificacaoIntegridade: m.dataVerificacaoIntegridade,
    ...(m.tags === undefined ? {} : { tags: [...m.tags] }),
    ...(m.notasEditoriais === undefined ? {} : { notasEditoriais: [...m.notasEditoriais] }),
    children: artigos.map((artigo, i) => materializar(artigo, i, entrada, linhas)),
  };

  return sucesso(raiz as unknown as ParsedNormaAST);
};

/** Slot vazio de Block ID, para deixar explícito o que a fase `parsed` produz. */
export type SemIdentificacao = SlotSemBlockId;
