// Reconciliação de identidade (Feature 004, T004-04 e T004-05).
//
// A ADR-001 faz do Block ID um identificador permanente: uma vez publicado, ele
// não é reciclado, removido nem recalculado. Tudo neste módulo existe para
// honrar isso quando a norma muda.
//
// O erro que este módulo evita é sutil e caro: recalcular o ID de um
// dispositivo publicado porque o texto dele mudou, ou porque um dispositivo
// novo passou a colidir com ele. Nos dois casos, links externos que apontavam
// para a posição jurídica certa passariam a apontar para outra coisa — sem
// erro, sem aviso, sem como descobrir depois.
//
// A chave de identidade é a **posição jurídica**, não o texto. É isso que faz a
// RF-004-03 valer de graça: mudar a redação de um artigo não muda a cadeia
// `art-121-par-2-inc-i`, então o ID permanece.

import {
  criarProblema,
  falha,
  type ProblemaValidacao,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { BlockIdDepreciado, IdentifiedNormaAST } from '../ast/nodes.js';

/**
 * O que já foi publicado desta norma.
 *
 * `namespace` é todo ID já emitido, **inclusive de dispositivos revogados,
 * renumerados e depreciados** — a §2.4 é explícita: a busca por ID livre
 * considera o histórico inteiro, senão um ID reciclado ressuscitaria links
 * antigos apontando para conteúdo novo.
 */
export interface RegistroPublicado {
  readonly namespace: readonly string[];
  /** Posição jurídica canônica (cadeia sem sigla) → Block ID publicado. */
  readonly porPosicao: Readonly<Record<string, string>>;
  readonly aliases: readonly BlockIdDepreciado[];
}

export const REGISTRO_VAZIO: RegistroPublicado = Object.freeze({
  namespace: [],
  porPosicao: {},
  aliases: [],
});

export interface ResultadoDaReconciliacao {
  readonly arvore: IdentifiedNormaAST;
  /** Redirects produzidos nesta reconciliação, a somar aos já publicados. */
  readonly aliasesNovos: readonly BlockIdDepreciado[];
  /** IDs publicados que não apareceram na candidata. */
  readonly ausentes: readonly string[];
}

type No = Record<string, unknown>;

const filhosDe = (no: No): No[] => (Array.isArray(no['children']) ? (no['children'] as No[]) : []);

/**
 * Verifica que os aliases formam um grafo acíclico e que nenhum destino é, ele
 * mesmo, origem de outro alias sem fim.
 *
 * Um ciclo `a → b → a` faria o servidor consumidor entrar em laço ao resolver
 * a referência; uma cadeia é aceitável, mas precisa terminar.
 */
export const verificarAliases = (
  aliases: readonly BlockIdDepreciado[],
): readonly ProblemaValidacao[] => {
  const problemas: ProblemaValidacao[] = [];
  const destino = new Map<string, string>();

  aliases.forEach((alias, indice) => {
    if (alias.antigo === alias.novo) {
      problemas.push(
        criarProblema(
          'ciclo',
          ['aliases', indice],
          `O alias "${alias.antigo}" aponta para si mesmo.`,
        ),
      );
      return;
    }

    const jaExiste = destino.get(alias.antigo);

    if (jaExiste !== undefined && jaExiste !== alias.novo) {
      // Alias é permanente: reapontá-lo mudaria o destino de um link já
      // publicado, que é a mesma quebra que renomear o ID.
      problemas.push(
        criarProblema(
          'block_id_duplicado',
          ['aliases', indice],
          `O alias "${alias.antigo}" já aponta para "${jaExiste}"; reapontá-lo para "${alias.novo}" quebraria links publicados.`,
        ),
      );
      return;
    }

    destino.set(alias.antigo, alias.novo);
  });

  for (const [origem] of destino) {
    const visitados = new Set<string>([origem]);
    let atual = destino.get(origem);

    while (atual !== undefined) {
      if (visitados.has(atual)) {
        problemas.push(
          criarProblema('ciclo', ['aliases'], `Os aliases formam ciclo a partir de "${origem}".`),
        );
        break;
      }

      visitados.add(atual);
      atual = destino.get(atual);
    }
  }

  return problemas;
};

interface Posicionado {
  readonly no: No;
  /** Cadeia canônica sem sigla, ex.: `art-121-par-2-inc-i`. */
  readonly posicao: string;
  readonly caminho: readonly (string | number)[];
}

/** Coleta os nós já identificados por posição jurídica. */
const posicoesDe = (raiz: IdentifiedNormaAST, sigla: string): readonly Posicionado[] => {
  const encontrados: Posicionado[] = [];
  const prefixo = `${sigla}-`;

  const visitar = (no: No, caminho: readonly (string | number)[]): void => {
    const blockId = no['blockId'];

    if (typeof blockId === 'string') {
      encontrados.push({
        no,
        posicao: blockId.startsWith(prefixo) ? blockId.slice(prefixo.length) : blockId,
        caminho,
      });
    }

    filhosDe(no).forEach((filho, i) => {
      visitar(filho, [...caminho, 'children', i]);
    });
  };

  visitar(raiz as unknown as No, []);

  return encontrados;
};

/**
 * Reconcilia a árvore candidata contra o que já foi publicado.
 *
 * A candidata chega já identificada — o gerador da primeira publicação rodou
 * sobre ela. O que este passo faz é **substituir** os IDs recém-gerados pelos
 * já publicados na mesma posição, e garantir que os genuinamente novos não
 * invadam o namespace histórico.
 */
export const reconciliar = (
  candidata: IdentifiedNormaAST,
  registro: RegistroPublicado,
  sigla: string,
): ResultadoValidacao<ResultadoDaReconciliacao> => {
  const problemasDeAlias = verificarAliases(registro.aliases);

  if (problemasDeAlias.length > 0) {
    return falha(problemasDeAlias);
  }

  const problemas: ProblemaValidacao[] = [];
  const candidatos = posicoesDe(candidata, sigla);
  const historico = new Set(registro.namespace);
  const aliasesNovos: BlockIdDepreciado[] = [];
  const idFinalPorNo = new Map<No, string>();
  const usados = new Set<string>();
  const posicoesVistas = new Map<string, readonly (string | number)[]>();

  for (const candidato of candidatos) {
    const anterior = posicoesVistas.get(candidato.posicao);

    if (anterior !== undefined) {
      // Duas posições idênticas na candidata: a identidade é ambígua e nenhuma
      // regra automática resolve qual delas herda o ID publicado.
      problemas.push(
        criarProblema(
          'block_id_duplicado',
          candidato.caminho,
          `A posição "${candidato.posicao}" aparece duas vezes na candidata; a identidade é ambígua (RF-004-04).`,
        ),
      );
      continue;
    }

    posicoesVistas.set(candidato.posicao, candidato.caminho);

    const publicado = registro.porPosicao[candidato.posicao];

    if (publicado !== undefined) {
      // Dispositivo já publicado nesta posição: mantém o ID, aconteça o que
      // acontecer com o texto. É a RF-004-03.
      idFinalPorNo.set(candidato.no, publicado);
      usados.add(publicado);
      continue;
    }

    // Dispositivo novo. Se o ID candidato já pertence ao namespace histórico,
    // ele não pode ser tomado — nem renomeando o publicado, que a §2.4 proíbe.
    const candidatoId = `${sigla}-${candidato.posicao}`;

    if (historico.has(candidatoId) || usados.has(candidatoId)) {
      problemas.push(
        criarProblema(
          'block_id_duplicado',
          [...candidato.caminho, 'blockId'],
          `O dispositivo novo produziria "${candidatoId}", que já existe no namespace histórico. Renomear o publicado é proibido (BLOCK_ID_SPEC §2.4); qualifique o novo.`,
        ),
      );
      continue;
    }

    idFinalPorNo.set(candidato.no, candidatoId);
    usados.add(candidatoId);
  }

  // Renumeração: o dispositivo declara para onde foi, e isso vira redirect —
  // nunca um ID novo para a mesma identidade jurídica.
  for (const candidato of candidatos) {
    const destino = candidato.no['renumeradoPara'];
    const atual = idFinalPorNo.get(candidato.no);

    if (typeof destino === 'string' && atual !== undefined && destino !== atual) {
      aliasesNovos.push({ antigo: atual, novo: destino });
    }
  }

  const todosOsAliases = [...registro.aliases, ...aliasesNovos];
  const problemasDosNovos = verificarAliases(todosOsAliases);

  if (problemasDosNovos.length > 0) {
    problemas.push(...problemasDosNovos);
  }

  if (problemas.length > 0) {
    return falha(problemas);
  }

  // ADR-009 §7: ausência na candidata não é revogação. O dispositivo some do
  // texto compilado por muitos motivos, e nenhum deles autoriza descartar a
  // identidade. Reportamos para decisão editorial.
  const posicoesDaCandidata = new Set(candidatos.map((c) => c.posicao));
  const ausentes = Object.entries(registro.porPosicao)
    .filter(([posicao]) => !posicoesDaCandidata.has(posicao))
    .map(([, id]) => id);

  const reconstruir = (no: No): No => {
    const id = idFinalPorNo.get(no);
    const filhos = filhosDe(no).map(reconstruir);

    return id === undefined
      ? { ...no, children: filhos }
      : { ...no, blockId: id, children: filhos };
  };

  const raiz = candidata as unknown as No;

  return sucesso({
    arvore: {
      ...raiz,
      children: filhosDe(raiz).map(reconstruir),
      ...(todosOsAliases.length === 0 ? {} : { idsDepreciados: todosOsAliases }),
    } as unknown as IdentifiedNormaAST,
    aliasesNovos,
    ausentes,
  });
};

/** Constrói o registro a partir de uma árvore publicada. */
export const registrarPublicacao = (
  publicada: IdentifiedNormaAST,
  sigla: string,
  anterior: RegistroPublicado = REGISTRO_VAZIO,
): RegistroPublicado => {
  const posicoes = posicoesDe(publicada, sigla);
  const porPosicao: Record<string, string> = { ...anterior.porPosicao };

  for (const { posicao, no } of posicoes) {
    const blockId = no['blockId'];

    if (typeof blockId === 'string') {
      porPosicao[posicao] = blockId;
    }
  }

  return {
    // O namespace só cresce: um ID que saiu do texto continua reservado.
    namespace: [
      ...new Set([...anterior.namespace, ...posicoes.map(({ no }) => String(no['blockId']))]),
    ],
    porPosicao,
    aliases: [...anterior.aliases, ...(publicada.idsDepreciados ?? [])],
  };
};
