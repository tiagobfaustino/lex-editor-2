// Parser da gramática normativa (Feature 004, T004-02).
//
// A tabela de designadores mora em `designadores.ts`; aqui fica o percurso que
// a aplica e monta a árvore. A hierarquia vem do tipo do designador, não de
// indentação: o texto oficial é plano.
//
// Linha que não casa com designador algum é erro, nunca texto anexado ao
// dispositivo anterior. Anexar seria conveniente e alteraria conteúdo jurídico
// em silêncio — o pior sucesso falso deste pipeline.

import {
  criarProblema,
  falha,
  type ProblemaValidacao,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { ParsedNormaAST, ParseEvidence, SourceReference } from '../ast/nodes.js';
import {
  ABREM_CONTEXTO,
  ehDivisao,
  nivelDaDivisao,
  PAIS_POSSIVEIS,
  reconhecer,
  type TipoDispositivo,
  type TipoDivisao,
  type TipoReconhecido,
} from './designadores.js';
import { interpretarNota, lerLinhaRiscada, type RedacaoAnteriorBruta } from './notas.js';

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

export interface EntradaDoParser {
  readonly conteudo: string;
  readonly referenciaBase: SourceReference;
  /** Hash de cada linha, para que `fragmentSha256` aponte para o fragmento real. */
  readonly hashDaLinha: (linha: string) => string;
  readonly metadados: MetadadosDaNorma;
}

/** Um dispositivo que termina em dois-pontos anuncia o que vem abaixo. */
const anunciaSubordinado = (texto: string): boolean => texto.trimEnd().endsWith(':');

interface NoEmConstrucao {
  readonly tipo: TipoReconhecido;
  numero: string;
  texto: string;
  readonly linha: number;
  readonly filhos: NoEmConstrucao[];
  evidencia: ParseEvidence;
  readonly estado: ReturnType<typeof interpretarNota>;
  readonly redacoesAnteriores: RedacaoAnteriorBruta[];
}

const EVIDENCIA_EXATA: ParseEvidence = {
  confidence: 'high',
  reasons: ['exact_legal_designator'],
  requiresHumanReview: false,
};

const EVIDENCIA_CONTEXTO: ParseEvidence = {
  confidence: 'medium',
  reasons: ['exact_legal_designator', 'hierarchy_inferred_from_context'],
  requiresHumanReview: false,
};

/**
 * Ancoragem ambígua de pena. A `low` obriga revisão humana, e a invariante da
 * Feature 004 impede que ela avance em silêncio para a AST identificada.
 */
const EVIDENCIA_AMBIGUA: ParseEvidence = {
  confidence: 'low',
  reasons: ['ambiguous_designator', 'hierarchy_inferred_from_context'],
  requiresHumanReview: true,
};

/**
 * Decide de quem é a pena.
 *
 * O sinal disponível no texto plano é o dois-pontos: um dispositivo que termina
 * em `:` anuncia o que vem abaixo, e é o candidato natural a dono da pena. Com
 * um único candidato aberto, a decisão é firme. Com mais de um — o § anuncia
 * uma lista e o último inciso também anuncia —, o texto plano genuinamente não
 * resolve: ancora no mais próximo e marca para revisão, em vez de fingir
 * certeza.
 *
 * Isto é o que faltava na Feature 003, onde duas linhas `Pena` do art. 121
 * tiveram de ficar fora da fixture.
 */
const ancorarPena = (
  abertos: readonly NoEmConstrucao[],
): { indice: number; evidencia: ParseEvidence } | undefined => {
  const candidatos: number[] = [];

  for (let i = abertos.length - 1; i >= 0; i -= 1) {
    const candidato = abertos[i];

    if (candidato === undefined || ehDivisao(candidato.tipo)) {
      continue;
    }

    if (candidato.tipo === 'pena') {
      continue;
    }

    if (anunciaSubordinado(candidato.texto)) {
      candidatos.push(i);
    }
  }

  if (candidatos.length === 1) {
    const [indice] = candidatos;

    return indice === undefined ? undefined : { indice, evidencia: EVIDENCIA_EXATA };
  }

  if (candidatos.length > 1) {
    const [indice] = candidatos;

    return indice === undefined ? undefined : { indice, evidencia: EVIDENCIA_AMBIGUA };
  }

  // Nenhum dispositivo anuncia subordinado: a pena pende do mais interno
  // aberto, que é a leitura corrente do texto.
  for (let i = abertos.length - 1; i >= 0; i -= 1) {
    const candidato = abertos[i];

    if (candidato !== undefined && !ehDivisao(candidato.tipo) && candidato.tipo !== 'pena') {
      return { indice: i, evidencia: EVIDENCIA_CONTEXTO };
    }
  }

  return undefined;
};

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
    parseEvidence: no.evidencia,
    children: no.filhos.map((filho, i) => materializar(filho, i, entrada, linhas)),
  };

  if (ehDivisao(no.tipo)) {
    return {
      ...comum,
      tipo: no.tipo,
      deviceStatus: 'active',
      ...(no.numero.length > 0 ? { numero: no.numero } : {}),
      titulo: no.texto,
    };
  }

  // O estado vem da nota oficial interpretada em `notas.ts`, não de inferência
  // sobre o texto: a MARKDOWN_SPEC §5.3 proíbe o Formatter adivinhar, e o
  // parser é quem tem a nota à mão.
  const estado = {
    deviceStatus: no.estado.deviceStatus,
    ...(no.estado.notaStatus === undefined ? {} : { notaStatus: no.estado.notaStatus }),
    ...(no.estado.preservarTextoRevogado === undefined
      ? {}
      : { preservarTextoRevogado: no.estado.preservarTextoRevogado }),
    ...(no.estado.redacaoAtualDadaPor === undefined
      ? {}
      : { redacaoAtualDadaPor: no.estado.redacaoAtualDadaPor }),
    // ADR-006 §4: ordem cronológica, da mais antiga para a mais nova. O
    // percurso já as acumulou nessa ordem.
    ...(no.redacoesAnteriores.length === 0
      ? {}
      : { redacoesAnteriores: no.redacoesAnteriores.map((r) => ({ ...r })) }),
  };

  switch (no.tipo) {
    case 'artigo':
      return { ...comum, ...estado, tipo: 'artigo', numero: no.numero, caput: no.texto };
    case 'paragrafo':
      return { ...comum, ...estado, tipo: 'paragrafo', numero: no.numero, texto: no.texto };
    case 'inciso':
      return { ...comum, ...estado, tipo: 'inciso', numero: no.numero, texto: no.texto };
    case 'alinea':
      return { ...comum, ...estado, tipo: 'alinea', letra: no.numero, texto: no.texto };
    case 'item':
      return { ...comum, ...estado, tipo: 'item', numero: no.numero, texto: no.texto };
    case 'anexo':
      return { ...comum, ...estado, tipo: 'anexo', numero: no.numero, titulo: no.texto };
    case 'tabela': {
      // Forma canônica da §3.3: `legenda|cab1; cab2|a1; b1 / a2; b2`.
      const [legenda = '', cabecalhos = '', linhasDaTabela = ''] = no.texto.split('|');

      return {
        ...comum,
        ...estado,
        tipo: 'tabela',
        numero: no.numero,
        caption: legenda.trim(),
        headers: cabecalhos
          .split(';')
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
        rows: linhasDaTabela
          .split('/')
          .map((linha) => linha.trim())
          .filter((linha) => linha.length > 0)
          .map((linha) => linha.split(';').map((celula) => celula.trim())),
        children: [],
      };
    }
    default:
      return {
        ...comum,
        ...estado,
        tipo: 'pena',
        ...(no.numero.length > 0 ? { numero: no.numero } : {}),
        texto: no.texto,
        children: [],
      };
  }
};

export const analisar = (entrada: EntradaDoParser): ResultadoValidacao<ParsedNormaAST> => {
  const linhas = entrada.conteudo.split('\n');
  const problemas: ProblemaValidacao[] = [];
  const raizes: NoEmConstrucao[] = [];
  /** Divisões abertas, da mais externa para a mais interna. */
  let divisoes: NoEmConstrucao[] = [];
  /** Dispositivos abertos dentro do artigo corrente. */
  let abertos: NoEmConstrucao[] = [];
  /** Divisão cujo título vem na próxima linha. */
  let aguardandoTitulo: NoEmConstrucao | undefined;
  /** Redações anteriores lidas e ainda não anexadas ao dispositivo vigente. */
  const historicoPendente: RedacaoAnteriorBruta[] = [];
  let artigos = 0;

  if (entrada.conteudo.trim().length === 0) {
    return falha([criarProblema('entrada_vazia', [], 'A entrada não tem conteúdo.')]);
  }

  const registrar = (problema: ProblemaValidacao): void => {
    if (problemas.length < 50) {
      problemas.push(problema);
    }
  };

  /** Onde um artigo ou divisão de topo entra. */
  const destinoDeTopo = (): NoEmConstrucao[] => {
    const interna = divisoes.at(-1);

    return interna === undefined ? raizes : interna.filhos;
  };

  linhas.forEach((linhaBruta, indice) => {
    const linha = linhaBruta.trim();

    if (linha.length === 0) {
      return;
    }

    if (aguardandoTitulo !== undefined) {
      aguardandoTitulo.texto = linha;
      aguardandoTitulo = undefined;
      return;
    }

    // ADR-006 §2 e MD §5.5: linha riscada sem Block ID é redação anterior.
    // Acumula e anexa ao próximo dispositivo — histórico é apresentação, não
    // posição referenciável, e por isso não vira nó nem recebe ID.
    const riscada = lerLinhaRiscada(linha);

    if (riscada !== undefined) {
      historicoPendente.push(riscada);
      return;
    }

    // Desembrulha o riscado antes de reconhecer: `~~SEÇÃO II~~` é uma divisão
    // riscada, não uma linha desconhecida. O estado vem depois, da nota.
    const envolvida = /^~~(.*?)~~\s*(\(.*\))?\s*$/u.exec(linha);
    const linhaLimpa =
      envolvida === null ? linha : `${envolvida[1] ?? ''} ${envolvida[2] ?? ''}`.trim();
    const veioRiscada = envolvida !== null;
    const reconhecido = reconhecer(linhaLimpa);

    if (reconhecido === undefined) {
      registrar(
        criarProblema(
          'designador_desconhecido',
          ['linhas', indice + 1],
          `A linha ${String(indice + 1)} não corresponde a nenhum designador suportado: ${JSON.stringify(linha.slice(0, 60))}.`,
        ),
      );
      return;
    }

    // O riscado costuma envolver só o texto, depois do designador:
    // `§ 1º ~~texto antigo~~ (Revogado pela Lei ...)`. Desembrulha antes de
    // interpretar, para que a nota seja lida da mesma forma nos dois casos.
    const interno = /^~~(.*)~~\s*(\(.*\))?\s*$/u.exec(reconhecido.texto);
    const riscado = veioRiscada || interno !== null;
    const textoParaNota =
      interno === null ? reconhecido.texto : `${interno[1] ?? ''} ${interno[2] ?? ''}`.trim();

    const estado = ehDivisao(reconhecido.tipo)
      ? { texto: reconhecido.texto, deviceStatus: 'active' as const }
      : interpretarNota(textoParaNota, riscado);

    const no: NoEmConstrucao = {
      tipo: reconhecido.tipo,
      numero: reconhecido.numero,
      texto: estado.texto,
      linha: indice,
      filhos: [],
      evidencia: EVIDENCIA_EXATA,
      estado,
      redacoesAnteriores: historicoPendente.splice(0),
    };

    if (ehDivisao(reconhecido.tipo)) {
      // Fecha as divisões de nível igual ou mais interno e abre esta.
      const nivel = nivelDaDivisao(reconhecido.tipo);

      divisoes = divisoes.filter((aberta) => nivelDaDivisao(aberta.tipo as TipoDivisao) < nivel);
      destinoDeTopo().push(no);
      divisoes.push(no);
      abertos = [];

      if (reconhecido.tituloPendente === true) {
        aguardandoTitulo = no;
      }

      return;
    }

    if (ABREM_CONTEXTO.has(reconhecido.tipo)) {
      // Artigo e anexo reiniciam a lista de dispositivos abertos. Um artigo
      // dentro de anexo, porém, pende dele: é o que faz o Block ID carregar o
      // segmento `anx-` antes do `art-` (BID §2.3.10).
      const anexoAberto = abertos.find((aberto) => aberto.tipo === 'anexo');

      if (reconhecido.tipo === 'artigo' && anexoAberto !== undefined) {
        anexoAberto.filhos.push(no);
        abertos = [anexoAberto, no];
      } else {
        destinoDeTopo().push(no);
        abertos = [no];
      }

      if (reconhecido.tipo === 'artigo') {
        artigos += 1;
      }

      if (reconhecido.tituloPendente === true) {
        aguardandoTitulo = no;
      }

      return;
    }

    if (reconhecido.tipo === 'pena') {
      const ancora = ancorarPena(abertos);

      if (ancora === undefined) {
        registrar(
          criarProblema(
            'dispositivo_orfao',
            ['linhas', indice + 1],
            `"pena" na linha ${String(indice + 1)} não tem dispositivo a que pertencer.`,
          ),
        );
        return;
      }

      no.evidencia = ancora.evidencia;
      abertos[ancora.indice]?.filhos.push(no);
      abertos = [...abertos.slice(0, ancora.indice + 1), no];
      return;
    }

    const paisPossiveis = PAIS_POSSIVEIS[reconhecido.tipo as TipoDispositivo];
    let profundidade = -1;

    for (let i = abertos.length - 1; i >= 0; i -= 1) {
      const candidato = abertos[i];

      if (
        candidato !== undefined &&
        !ehDivisao(candidato.tipo) &&
        (paisPossiveis as readonly string[]).includes(candidato.tipo)
      ) {
        profundidade = i;
        break;
      }
    }

    if (profundidade === -1) {
      registrar(
        criarProblema(
          'dispositivo_orfao',
          ['linhas', indice + 1],
          `"${reconhecido.tipo}" na linha ${String(indice + 1)} não tem dispositivo pai; esperado um de: ${paisPossiveis.join(', ')}.`,
        ),
      );
      return;
    }

    abertos[profundidade]?.filhos.push(no);
    abertos = [...abertos.slice(0, profundidade + 1), no];
  });

  if (aguardandoTitulo !== undefined) {
    registrar(
      criarProblema(
        'designador_desconhecido',
        ['linhas', aguardandoTitulo.linha + 1],
        `A divisão da linha ${String(aguardandoTitulo.linha + 1)} ficou sem ementa.`,
      ),
    );
  }

  if (problemas.length > 0) {
    return falha(problemas);
  }

  if (artigos === 0) {
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
    totalArtigos: artigos,
    versaoVinculex: m.versaoVinculex,
    legalStatus: m.legalStatus,
    publicationStatus: m.publicationStatus,
    dataVerificacaoIntegridade: m.dataVerificacaoIntegridade,
    ...(m.tags === undefined ? {} : { tags: [...m.tags] }),
    ...(m.notasEditoriais === undefined ? {} : { notasEditoriais: [...m.notasEditoriais] }),
    children: raizes.map((no, i) => materializar(no, i, entrada, linhas)),
  };

  return sucesso(raiz as unknown as ParsedNormaAST);
};

export { DIVISOES, reconhecer } from './designadores.js';
export type { TipoDispositivo, TipoDivisao } from './designadores.js';
