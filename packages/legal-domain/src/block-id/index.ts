// Atribuição de Block IDs (BLOCK_ID_SPEC.md §8).
//
// Primeira publicação: não há registro histórico a reconciliar — isso é a
// T004-04. O que existe aqui é a geração canônica, a passada de desambiguação
// por divisão (§8.3) e a recusa de colisão irredutível.
//
// A política da §7.3 é explícita: colisão não se resolve com contador. Sufixar
// `-2` faria um link estável apontar para o dispositivo errado. A única
// resolução automática permitida é qualificação estrutural, e é o que a passada
// de desambiguação faz.

import {
  criarProblema,
  falha,
  type ProblemaValidacao,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { IdentifiedNormaAST, ParsedNormaAST } from '../ast/nodes.js';

const ROMANOS = /^[ivxlcdm]+(-[a-z]+)?$/u;

const normalizarNumeroArtigo = (bruto: string): string =>
  bruto.trim().toLowerCase().replace(/\s+/gu, '');

const normalizarParagrafo = (bruto: string): string => {
  const valor = bruto.trim().toLowerCase();

  if (valor === 'único' || valor === 'unico') {
    return 'unico';
  }

  // Preserva o sufixo alfabético de "§ 2º-A".
  const casamento = /^(\d+)(?:-([a-z]+))?/u.exec(valor.replace(/[º°o]/gu, ''));

  if (casamento === null) {
    return '';
  }

  return casamento[2] === undefined
    ? (casamento[1] ?? '')
    : `${casamento[1] ?? ''}-${casamento[2]}`;
};

const normalizarLetra = (bruto: string): string =>
  bruto
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/gu, '');

const normalizarCardinal = (bruto: string): string => bruto.trim().replace(/\D/gu, '');

const semAcento = (valor: string): string => valor.normalize('NFD').replace(/\p{Diacritic}/gu, '');

const ROMANO_PARA_INTEIRO: Readonly<Record<string, number>> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

/** "III" → 3. A §2.4 exige a posição cardinal da divisão, não o romano do texto. */
const romanoParaInteiro = (romano: string): number => {
  let total = 0;

  for (let i = 0; i < romano.length; i += 1) {
    const atual = ROMANO_PARA_INTEIRO[romano[i] ?? ''] ?? 0;
    const proximo = ROMANO_PARA_INTEIRO[romano[i + 1] ?? ''] ?? 0;

    total += atual < proximo ? -atual : atual;
  }

  return total;
};

const ABREVIACAO_DA_DIVISAO: Readonly<Record<string, string>> = {
  livro: 'liv',
  titulo: 'tit',
  capitulo: 'cap',
  secao: 'sec',
  subsecao: 'sub',
};

/** Segmento de divisão: `{abrev}-{ordinal cardinal}` (§2.4). */
const segmentoDaDivisao = (no: Record<string, unknown>): string => {
  const abreviacao = ABREVIACAO_DA_DIVISAO[String(no['tipo'])] ?? '';
  const bruto = typeof no['numero'] === 'string' ? no['numero'].trim().toLowerCase() : '';

  if (bruto.length === 0) {
    return abreviacao;
  }

  const cardinal = /^\d+$/u.test(bruto) ? Number(bruto) : romanoParaInteiro(bruto);

  return `${abreviacao}-${String(cardinal)}`;
};

type Segmento =
  { readonly ok: true; readonly valor: string } | { readonly ok: false; readonly motivo: string };

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
      // §2.3.12: só numera com ordem jurídica explícita na fonte. O gerador
      // nunca inventa numeração pela ordem de parsing.
      const valor = normalizarCardinal(numero);

      return { ok: true, valor: valor.length > 0 ? `pena-${valor}` : 'pena' };
    }
    case 'anexo': {
      const valor = semAcento(numero).trim().toLowerCase();

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

type No = Record<string, unknown>;

const filhosDe = (no: No): No[] => (Array.isArray(no['children']) ? (no['children'] as No[]) : []);

interface Candidato {
  readonly no: No;
  /** Segmento próprio, ex.: `art-121` ou `inc-i`. */
  readonly segmento: string;
  /** Candidato referenciável que o contém, se houver. */
  readonly pai: Candidato | undefined;
  /** Cadeia de segmentos de dispositivo, sem divisões. */
  readonly cadeia: readonly string[];
  /** Divisões ancestrais, da mais externa para a mais interna. */
  readonly divisoes: readonly No[];
  readonly caminho: readonly (string | number)[];
}

/**
 * Passada de desambiguação (§8.3).
 *
 * Percorre todos os candidatos e agrupa por ID simples. Onde dois ou mais
 * colidem, escolhe a **menor** divisão ancestral que os separa e a marca como
 * necessária para todos os conflitantes — a §2.4 é explícita em qualificar
 * todos, não só um, quando todos são inéditos.
 */
const qualificacoes = (candidatos: readonly Candidato[]): ReadonlyMap<Candidato, string> => {
  const qualificacao = new Map<Candidato, string>();
  const porId = new Map<string, Candidato[]>();

  for (const candidato of candidatos) {
    const chave = candidato.cadeia.join('-');
    const grupo = porId.get(chave);

    if (grupo === undefined) {
      porId.set(chave, [candidato]);
    } else {
      grupo.push(candidato);
    }
  }

  for (const grupo of porId.values()) {
    if (grupo.length < 2) {
      continue;
    }

    // Procura o nível de divisão mais raso que já separa todos do grupo.
    const profundidadeMaxima = Math.max(...grupo.map((c) => c.divisoes.length));

    for (let nivel = 0; nivel < profundidadeMaxima; nivel += 1) {
      const assinaturas = grupo.map((c) => {
        const divisao = c.divisoes[nivel];

        return divisao === undefined ? '' : segmentoDaDivisao(divisao);
      });

      if (new Set(assinaturas).size === grupo.length) {
        grupo.forEach((candidato, i) => {
          // A qualificação pertence ao candidato conflitante, não à divisão:
          // um irmão que não colide continua com o ID simples, como a §2.4
          // exige ao mandar qualificar "todos os candidatos conflitantes" — e
          // só eles. Os descendentes herdam pelo ID do pai.
          qualificacao.set(candidato, assinaturas[i] ?? '');
        });
        break;
      }
    }
  }

  return qualificacao;
};

export interface OpcoesDeIdentificacao {
  /**
   * Permite identificar mesmo com nó de baixa confiança. Existe para teste e
   * para diagnóstico; o pipeline normal não usa.
   */
  readonly permitirBaixaConfianca?: boolean;
}

/**
 * Converte a árvore `parsed` em `identified`, com Block ID em todo nó
 * referenciável. Não muta a entrada.
 */
export const identificar = (
  arvore: ParsedNormaAST,
  sigla: string,
  opcoes: OpcoesDeIdentificacao = {},
): ResultadoValidacao<IdentifiedNormaAST> => {
  const problemas: ProblemaValidacao[] = [];
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

  const raizComoRegistro = arvore as unknown as No;

  // --- Invariante da Feature 004 ---
  // Baixa confiança nunca avança silenciosamente para a AST identificada.
  // Identificar significa emitir Block ID, e Block ID publicado é imutável:
  // atribuir identidade permanente a uma interpretação que o parser mesmo
  // marcou como duvidosa é o erro que não dá para desfazer depois.
  if (opcoes.permitirBaixaConfianca !== true) {
    const duvidosos: (string | number)[][] = [];

    const varrer = (no: No, caminho: readonly (string | number)[]): void => {
      const evidencia = no['parseEvidence'];

      if (
        typeof evidencia === 'object' &&
        evidencia !== null &&
        (evidencia as { confidence?: unknown }).confidence === 'low'
      ) {
        duvidosos.push([...caminho]);
      }

      filhosDe(no).forEach((filho, i) => {
        varrer(filho, [...caminho, 'children', i]);
      });
    };

    varrer(raizComoRegistro, []);

    if (duvidosos.length > 0) {
      return falha(
        duvidosos.map((caminho) =>
          criarProblema(
            'confianca_baixa_sem_revisao',
            [...caminho, 'parseEvidence'],
            'Confiança "low" exige decisão editorial antes da identificação; um Block ID emitido aqui seria permanente.',
          ),
        ),
      );
    }
  }

  // --- Coleta de candidatos ---
  const candidatos: Candidato[] = [];

  const coletar = (
    no: No,
    pai: Candidato | undefined,
    cadeia: readonly string[],
    divisoes: readonly No[],
    caminho: readonly (string | number)[],
  ): void => {
    const tipo = typeof no['tipo'] === 'string' ? no['tipo'] : '';

    if (DIVISOES.has(tipo)) {
      filhosDe(no).forEach((filho, i) => {
        coletar(filho, pai, cadeia, [...divisoes, no], [...caminho, 'children', i]);
      });
      return;
    }

    if (!REFERENCIAVEIS.has(tipo)) {
      filhosDe(no).forEach((filho, i) => {
        coletar(filho, pai, cadeia, divisoes, [...caminho, 'children', i]);
      });
      return;
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
      return;
    }

    const proxima = [...cadeia, segmento.valor];
    const candidato: Candidato = {
      no,
      segmento: segmento.valor,
      pai,
      cadeia: proxima,
      divisoes,
      caminho,
    };

    candidatos.push(candidato);

    filhosDe(no).forEach((filho, i) => {
      coletar(filho, candidato, proxima, divisoes, [...caminho, 'children', i]);
    });
  };

  filhosDe(raizComoRegistro).forEach((filho, i) => {
    coletar(filho, undefined, [], [], ['children', i]);
  });

  if (problemas.length > 0) {
    return falha(problemas);
  }

  const qualificacao = qualificacoes(candidatos);

  // --- Emissão ---
  const idPorNo = new Map<No, string>();
  const idPorCandidato = new Map<Candidato, string>();
  const emitidos = new Map<string, readonly (string | number)[]>();

  // Em ordem de árvore: o ID de um candidato é o do pai mais o próprio
  // segmento, então a qualificação aplicada a um artigo desce sozinha para
  // seus parágrafos e incisos, sem alcançar irmãos que não colidiram.
  for (const candidato of candidatos) {
    const idDoPai =
      candidato.pai === undefined
        ? siglaNormalizada
        : (idPorCandidato.get(candidato.pai) ?? siglaNormalizada);
    const divisao = qualificacao.get(candidato);
    const blockId = [idDoPai, ...(divisao === undefined ? [] : [divisao]), candidato.segmento].join(
      '-',
    );

    idPorCandidato.set(candidato, blockId);

    const anterior = emitidos.get(blockId);

    if (anterior === undefined) {
      emitidos.set(blockId, candidato.caminho);
      idPorNo.set(candidato.no, blockId);
    } else {
      problemas.push(
        criarProblema(
          'block_id_duplicado',
          [...candidato.caminho, 'blockId'],
          `O Block ID "${blockId}" colidiu com o de /${anterior.join('/')} e nenhuma divisão ancestral os separa. A resolução por contador é proibida (BLOCK_ID_SPEC §7.3).`,
          typeof candidato.no['id'] === 'string' ? candidato.no['id'] : undefined,
        ),
      );
    }
  }

  if (problemas.length > 0) {
    return falha(problemas);
  }

  const reconstruir = (no: No): No => {
    const blockId = idPorNo.get(no);
    const filhos = filhosDe(no).map(reconstruir);

    return blockId === undefined
      ? { ...no, children: filhos }
      : { ...no, blockId, children: filhos };
  };

  return sucesso({
    ...raizComoRegistro,
    astPhase: 'identified',
    children: filhosDe(raizComoRegistro).map(reconstruir),
  } as unknown as IdentifiedNormaAST);
};

export const contarBlockIds = (arvore: IdentifiedNormaAST): number => {
  let total = 0;

  const visitar = (no: No): void => {
    if (typeof no['blockId'] === 'string') {
      total += 1;
    }

    for (const filho of filhosDe(no)) {
      visitar(filho);
    }
  };

  visitar(arvore as unknown as No);

  return total;
};
