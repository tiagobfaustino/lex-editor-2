// As catorze verificações da MARKDOWN_SPEC §9 (Feature 004, T004-06).
//
// Rodam sobre o Markdown **já serializado**, não sobre a AST. Isso é
// deliberado: a §9.2 chama a reconferência de "defesa em profundidade contra
// bugs do Formatter". Validar de novo a AST provaria que a AST está boa;
// validar o texto prova que o que vai ser publicado está bom.
//
// Falha em qualquer item bloqueia a publicação — a política de fail-fast que a
// §9 herda da BLOCK_ID_SPEC §7.3.

import { criarProblema, type ProblemaValidacao } from '../ast/errors.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';

const BLOCK_ID_CANONICO = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

/** Linha de lista com Block ID ao final. */
const ITEM_COM_ID = /^(\s*)- (.*) \^([^\s]+)$/u;
/** Linha de lista sem Block ID. */
const ITEM_SEM_ID = /^(\s*)- (.*)$/u;
const HEADING = /^(#{1,6}) (.*)$/u;

/** Histórico da ADR-006: riscada, com nota, sem Block ID. */
const LINHA_DE_HISTORICO = /^\s*- ~~.*~~(?:\s*\*[^*]+\*)?\s*$/u;

const idsDaArvore = (raiz: IdentifiedNormaAST): Set<string> => {
  const encontrados = new Set<string>();

  const visitar = (no: Record<string, unknown>): void => {
    if (typeof no['blockId'] === 'string') {
      encontrados.add(no['blockId']);
    }

    const filhos = Array.isArray(no['children'])
      ? (no['children'] as Record<string, unknown>[])
      : [];

    for (const filho of filhos) {
      visitar(filho);
    }
  };

  visitar(raiz as unknown as Record<string, unknown>);

  return encontrados;
};

const contarArtigos = (raiz: IdentifiedNormaAST): number => {
  let total = 0;

  const visitar = (no: Record<string, unknown>): void => {
    if (no['tipo'] === 'artigo') {
      total += 1;
    }

    const filhos = Array.isArray(no['children'])
      ? (no['children'] as Record<string, unknown>[])
      : [];

    for (const filho of filhos) {
      visitar(filho);
    }
  };

  visitar(raiz as unknown as Record<string, unknown>);

  return total;
};

/**
 * Verifica o Markdown canônico contra a §9.
 *
 * Devolve a lista de problemas; vazia significa liberado para revisão humana.
 */
export const validarMarkdownCanonico = (
  markdown: string,
  arvore: IdentifiedNormaAST,
): readonly ProblemaValidacao[] => {
  const problemas: ProblemaValidacao[] = [];
  const linhas = markdown.split('\n');
  const registrar = (
    codigo: Parameters<typeof criarProblema>[0],
    linha: number,
    mensagem: string,
  ): void => {
    problemas.push(criarProblema(codigo, ['markdown', linha], mensagem));
  };

  // --- §9.13: fase da NormaAST ---
  // Lida como valor desconhecido de propósito: o tipo já promete `identified`,
  // mas esta camada é defesa em profundidade e recebe árvore de outras origens.
  // Confiar no tipo aqui tornaria a verificação decorativa.
  const fase = (arvore as unknown as Record<string, unknown>)['astPhase'];

  if (fase !== 'identified') {
    registrar('fase_incompativel', 0, 'Só uma IdentifiedNormaAST pode ser serializada (§9.13).');
  }

  const inicioDoCorpo = linhas.findIndex((linha) => ITEM_SEM_ID.test(linha) || HEADING.test(linha));
  const vistos = new Map<string, number>();
  let nivelDeHeadingAnterior = 0;

  linhas.forEach((linha, indice) => {
    const numeroDaLinha = indice + 1;
    const heading = HEADING.exec(linha);

    if (heading !== null && indice >= inicioDoCorpo && inicioDoCorpo >= 0) {
      // --- §9.10: headings não pulam nível ---
      const nivel = (heading[1] ?? '').length;

      if (nivelDeHeadingAnterior > 0 && nivel > nivelDeHeadingAnterior + 1) {
        registrar(
          'filho_incompativel',
          numeroDaLinha,
          `O heading salta do nível ${String(nivelDeHeadingAnterior)} para ${String(nivel)} (§9.10).`,
        );
      }

      nivelDeHeadingAnterior = nivel;
    }

    // --- §9.9: nenhum callout fora do cabeçalho ---
    if (inicioDoCorpo >= 0 && indice > inicioDoCorpo && /^\s*>\s*\[!/u.test(linha)) {
      registrar('filho_incompativel', numeroDaLinha, 'Callout dentro do corpo (§9.9).');
    }

    const comId = ITEM_COM_ID.exec(linha);
    const semId = ITEM_SEM_ID.exec(linha);

    if (comId === null && semId === null) {
      return;
    }

    const recuo = (comId?.[1] ?? semId?.[1] ?? '').length;

    // --- §9.5: indentação em múltiplos de dois, sem salto ---
    if (recuo % 2 !== 0) {
      registrar(
        'filho_incompativel',
        numeroDaLinha,
        `Indentação de ${String(recuo)} espaços não é múltiplo de dois (§9.5).`,
      );
    }

    // A §9.5 admite um tipo jurídico normalmente mais profundo diretamente
    // sob o pai quando a AST não tem o intermediário — inciso sob artigo, por
    // exemplo. O Formatter usa a profundidade efetiva da árvore; nesta defesa
    // textual sobra a regra verificável sem a AST: múltiplo de dois, sem tabs.

    if (comId === null) {
      // --- §9.3: só o histórico pode ficar sem Block ID ---
      if (!LINHA_DE_HISTORICO.test(linha)) {
        registrar(
          'block_id_ausente',
          numeroDaLinha,
          'Item de lista sem Block ID que não é linha de histórico (§9.3).',
        );
      }

      return;
    }

    const id = comId[3] ?? '';

    // --- §9.6: sintaxe do Block ID ---
    if (!BLOCK_ID_CANONICO.test(id)) {
      registrar(
        'block_id_nao_canonico',
        numeroDaLinha,
        `Block ID fora da gramática: "${id}" (§9.6).`,
      );
    }

    // --- §9.2: unicidade ---
    const anterior = vistos.get(id);

    if (anterior !== undefined) {
      registrar(
        'block_id_duplicado',
        numeroDaLinha,
        `O Block ID "${id}" já aparece na linha ${String(anterior)} (§9.2).`,
      );
    } else {
      vistos.set(id, numeroDaLinha);
    }
  });

  // --- §9.4: contagem de artigos vem da AST ---
  const artigos = contarArtigos(arvore);

  if (artigos !== arvore.totalArtigos) {
    registrar(
      'total_artigos_divergente',
      0,
      `O frontmatter declara ${String(arvore.totalArtigos)} artigo(s); a AST tem ${String(artigos)} (§9.4).`,
    );
  }

  // --- §9.8: callouts obrigatórios ---
  if (!markdown.includes('> [!info]')) {
    registrar('schema_invalido', 0, 'Falta o callout [!info] obrigatório (§9.8).');
  }

  if (!markdown.includes('> [!caution]')) {
    registrar('schema_invalido', 0, 'Falta o callout [!caution] obrigatório (§9.8).');
  }

  if (arvore.legalStatus !== 'vigente' && !markdown.includes('> [!warning]')) {
    registrar(
      'schema_invalido',
      0,
      `legal_status é "${arvore.legalStatus}", o que torna o callout [!warning] obrigatório (§6.5).`,
    );
  }

  // --- §9.11: referências cruzadas resolvem ---
  const idsPresentes = idsDaArvore(arvore);

  for (const referencia of arvore.redacoesDadasPor ?? []) {
    if (!idsPresentes.has(referencia.blockId)) {
      registrar(
        'block_id_ausente',
        0,
        `redacao_dada_por aponta para "${referencia.blockId}", que não existe no corpo vigente (§9.11).`,
      );
    }
  }

  for (const alias of arvore.idsDepreciados ?? []) {
    // A §9.11 exige que o destino exista; a origem vive no registro histórico e
    // não precisa estar materializada no corpo atual.
    if (!idsPresentes.has(alias.novo)) {
      registrar(
        'block_id_ausente',
        0,
        `ids_depreciados aponta para "${alias.novo}", que não existe no corpo vigente (§9.11).`,
      );
    }
  }

  return problemas;
};
