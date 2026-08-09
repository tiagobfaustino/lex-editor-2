// Projeção AST ↔ Postgres (Feature 004, T004-09).
//
// Adaptador puro, testado como o `plan.md` manda — antes de banco real. Não
// abre conexão nem monta SQL: produz e consome as **linhas** que o schema de
// `DATA_MODEL.md` §Schema Postgres/Supabase descreve.
//
// A árvore vira lista plana com `parent_id`, e a volta remonta a árvore pela
// ordem. O que precisa sobreviver ao round-trip é a semântica, não o formato:
// `camelCase` na AST, `snake_case` na fronteira, como a ADR-005 define.
//
// O risco que os testes de ida e volta cobrem é perda silenciosa. Um campo
// esquecido na projeção não quebra nada na hora — some na publicação, e só
// aparece quando alguém procurar o histórico de um dispositivo e não achar.

import {
  criarProblema,
  falha,
  type ProblemaValidacao,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { identifiedNormaAstSchema } from '../ast/schemas.js';

type No = Record<string, unknown>;

const filhosDe = (no: No): No[] => (Array.isArray(no['children']) ? (no['children'] as No[]) : []);

/** Linha de `dispositivos`, em `snake_case` como no banco. */
export interface LinhaDeDispositivo {
  readonly id: string;
  readonly parent_id: string | null;
  readonly tipo: string;
  readonly block_id: string | null;
  readonly numero: string | null;
  readonly titulo: string | null;
  readonly texto: string | null;
  readonly conteudo_estruturado: { headers: string[]; rows: string[][] } | null;
  readonly ordem: number;
  readonly device_status: string;
  readonly nota_status: string | null;
  readonly preservar_texto_revogado: boolean | null;
  readonly redacao_atual_dada_por: string | null;
  readonly redacoes_anteriores: readonly { texto: string; nota?: string }[];
  readonly renumerado_para_block_id: string | null;
  readonly source_ref: unknown;
  readonly supporting_source_refs: readonly unknown[];
  readonly parse_evidence: unknown;
}

/** Linha de `leis`, restrita ao que a AST carrega. */
export interface LinhaDeLei {
  readonly sigla: string;
  readonly titulo: string;
  readonly tipo: string;
  readonly numero: string;
  readonly ano: number;
  readonly ramo: string;
  readonly fonte_url: string;
  readonly data_publicacao: string;
  readonly legal_status: string;
  readonly publication_status: string;
}

/** Linha de `versoes_lei`, restrita ao que a AST carrega. */
export interface LinhaDeVersao {
  readonly versao_vinculex: string;
  readonly data_atualizacao_legal: string;
  readonly data_formatacao_vinculex: string;
  readonly total_artigos: number;
  readonly tags: readonly string[];
  readonly revogada_por: string | null;
  readonly redacoes_dadas_por: readonly unknown[];
  readonly ids_depreciados: readonly unknown[];
  readonly fontes_secundarias: readonly string[];
  readonly data_verificacao_integridade: string;
  readonly avisos_atualizacao: readonly string[];
  readonly notas_editoriais: readonly string[];
}

/**
 * Campos de nó da raiz.
 *
 * **Lacuna do DATA_MODEL.** `LeiNode` estende `NormaNodeBase`, então a raiz
 * carrega `id`, `ordem`, `sourceRef`, `supportingSourceRefs` e
 * `parseEvidence`. Nem `leis` nem `versoes_lei` têm coluna para nenhum deles, e
 * `dispositivos` não aceita `tipo = 'lei'` — o CHECK enumera os quinze tipos e
 * a raiz não está entre eles.
 *
 * Sem isto, a ida e volta perderia a rastreabilidade da própria norma: de que
 * artefato ela veio e com que confiança foi interpretada. O adaptador carrega
 * os campos explicitamente para que a perda não seja silenciosa; onde eles vão
 * morar no banco é decisão que a Feature 007 precisa tomar.
 */
export interface LinhaDaRaiz {
  readonly id: string;
  readonly ordem: number;
  readonly source_ref: unknown;
  readonly supporting_source_refs: readonly unknown[];
  readonly parse_evidence: unknown;
}

export interface Projecao {
  readonly lei: LinhaDeLei;
  readonly versao: LinhaDeVersao;
  readonly raiz: LinhaDaRaiz;
  readonly dispositivos: readonly LinhaDeDispositivo[];
}

const DIVISOES = new Set(['ato_transitorio', 'livro', 'titulo', 'capitulo', 'secao', 'subsecao']);

const texto = (valor: unknown): string | null => (typeof valor === 'string' ? valor : null);

/**
 * AST → linhas. A ordem da lista é a de percurso em profundidade, e é ela que
 * a volta usa para remontar: `ordem` posiciona entre irmãos, `parent_id` diz
 * de quem se é filho.
 */
export const projetar = (arvore: IdentifiedNormaAST): Projecao => {
  const dispositivos: LinhaDeDispositivo[] = [];

  const visitar = (no: No, paiId: string | null): void => {
    const tipo = String(no['tipo']);
    const id = String(no['id']);
    const ehTabela = tipo === 'tabela';

    dispositivos.push({
      id,
      parent_id: paiId,
      tipo,
      block_id: texto(no['blockId']),
      numero: texto(no['numero']) ?? texto(no['letra']),
      // `titulo` guarda a ementa da divisão e do anexo; a caption da tabela
      // cabe aqui também, conforme o comentário da coluna no DATA_MODEL.
      titulo: texto(no['titulo']) ?? (ehTabela ? texto(no['caption']) : null),
      texto: texto(no['texto']) ?? texto(no['caput']),
      conteudo_estruturado: ehTabela
        ? {
            headers: Array.isArray(no['headers']) ? (no['headers'] as string[]) : [],
            rows: Array.isArray(no['rows']) ? (no['rows'] as string[][]) : [],
          }
        : null,
      ordem: typeof no['ordem'] === 'number' ? no['ordem'] : 0,
      device_status: typeof no['deviceStatus'] === 'string' ? no['deviceStatus'] : 'active',
      nota_status: texto(no['notaStatus']),
      preservar_texto_revogado:
        typeof no['preservarTextoRevogado'] === 'boolean' ? no['preservarTextoRevogado'] : null,
      redacao_atual_dada_por: texto(no['redacaoAtualDadaPor']),
      redacoes_anteriores: Array.isArray(no['redacoesAnteriores'])
        ? (no['redacoesAnteriores'] as { texto: string; nota?: string }[])
        : [],
      renumerado_para_block_id: texto(no['renumeradoPara']),
      source_ref: no['sourceRef'],
      supporting_source_refs: Array.isArray(no['supportingSourceRefs'])
        ? (no['supportingSourceRefs'] as unknown[])
        : [],
      parse_evidence: no['parseEvidence'],
    });

    for (const filho of filhosDe(no)) {
      visitar(filho, id);
    }
  };

  const raiz = arvore as unknown as No;

  for (const filho of filhosDe(raiz)) {
    visitar(filho, null);
  }

  return {
    lei: {
      sigla: arvore.sigla,
      titulo: arvore.titulo,
      tipo: arvore.tipoNorma,
      numero: arvore.numero,
      ano: arvore.ano,
      ramo: arvore.ramo,
      fonte_url: arvore.fonte,
      data_publicacao: arvore.dataPublicacao,
      legal_status: arvore.legalStatus,
      publication_status: arvore.publicationStatus,
    },
    raiz: {
      id: arvore.id,
      ordem: arvore.ordem,
      source_ref: arvore.sourceRef,
      supporting_source_refs: arvore.supportingSourceRefs ?? [],
      parse_evidence: arvore.parseEvidence,
    },
    versao: {
      versao_vinculex: arvore.versaoVinculex,
      data_atualizacao_legal: arvore.dataAtualizacaoLegal,
      data_formatacao_vinculex: arvore.dataFormatacaoVinculex,
      total_artigos: arvore.totalArtigos,
      tags: arvore.tags ?? [],
      revogada_por: arvore.revogadaPor ?? null,
      redacoes_dadas_por: arvore.redacoesDadasPor ?? [],
      ids_depreciados: arvore.idsDepreciados ?? [],
      fontes_secundarias: arvore.fontesSecundarias ?? [],
      data_verificacao_integridade: arvore.dataVerificacaoIntegridade,
      avisos_atualizacao: arvore.avisosAtualizacao ?? [],
      notas_editoriais: arvore.notasEditoriais ?? [],
    },
    dispositivos,
  };
};

const semNulos = (entradas: readonly (readonly [string, unknown])[]): Record<string, unknown> =>
  Object.fromEntries(entradas.filter(([, valor]) => valor !== null && valor !== undefined));

/** Linhas → AST. Reconstrói a árvore pela cadeia de `parent_id`. */
export const reconstruir = (projecao: Projecao): ResultadoValidacao<IdentifiedNormaAST> => {
  const problemas: ProblemaValidacao[] = [];
  const porId = new Map<string, No>();
  const filhosPorPai = new Map<string | null, No[]>();

  for (const linha of projecao.dispositivos) {
    const ehDivisao = DIVISOES.has(linha.tipo);
    const ehTabela = linha.tipo === 'tabela';
    const ehArtigo = linha.tipo === 'artigo';
    const ehAlinea = linha.tipo === 'alinea';

    const no: No = {
      ...semNulos([
        ['id', linha.id],
        ['ordem', linha.ordem],
        ['tipo', linha.tipo],
        ['sourceRef', linha.source_ref],
        ['parseEvidence', linha.parse_evidence],
        ['deviceStatus', linha.device_status],
        ['blockId', linha.block_id],
        ['notaStatus', linha.nota_status],
        ['preservarTextoRevogado', linha.preservar_texto_revogado],
        ['redacaoAtualDadaPor', linha.redacao_atual_dada_por],
        ['renumeradoPara', linha.renumerado_para_block_id],
        // A alínea guarda a letra; os demais, o número.
        [ehAlinea ? 'letra' : 'numero', linha.numero],
        [ehArtigo ? 'caput' : 'texto', linha.texto],
        [ehDivisao || linha.tipo === 'anexo' ? 'titulo' : 'caption', linha.titulo],
      ]),
      ...(linha.supporting_source_refs.length > 0
        ? { supportingSourceRefs: [...linha.supporting_source_refs] }
        : {}),
      ...(linha.redacoes_anteriores.length > 0
        ? { redacoesAnteriores: linha.redacoes_anteriores.map((r) => ({ ...r })) }
        : {}),
      ...(ehTabela && linha.conteudo_estruturado !== null
        ? {
            headers: [...linha.conteudo_estruturado.headers],
            rows: linha.conteudo_estruturado.rows.map((l) => [...l]),
          }
        : {}),
      children: [],
    };

    porId.set(linha.id, no);
    const irmaos = filhosPorPai.get(linha.parent_id) ?? [];

    irmaos.push(no);
    filhosPorPai.set(linha.parent_id, irmaos);
  }

  // Liga cada nó ao pai, ordenando por `ordem` — a lista pode chegar do banco
  // em qualquer ordem, e a posição entre irmãos é dado, não acaso.
  for (const [paiId, filhos] of filhosPorPai) {
    const ordenados = [...filhos].sort((a, b) => Number(a['ordem']) - Number(b['ordem']));

    if (paiId === null) {
      continue;
    }

    const pai = porId.get(paiId);

    if (pai === undefined) {
      problemas.push(
        criarProblema('schema_invalido', ['dispositivos'], `parent_id "${paiId}" não existe.`),
      );
      continue;
    }

    pai['children'] = ordenados;
  }

  if (problemas.length > 0) {
    return falha(problemas);
  }

  const raizes = [...(filhosPorPai.get(null) ?? [])].sort(
    (a, b) => Number(a['ordem']) - Number(b['ordem']),
  );

  const { lei, versao } = projecao;
  const arvore = {
    tipo: 'lei',
    astPhase: 'identified',
    // A raiz não é uma linha de `dispositivos`: o CHECK do tipo não a admite.
    // Os campos de nó dela vêm de `projecao.raiz` — ver LinhaDaRaiz.
    id: projecao.raiz.id,
    ordem: projecao.raiz.ordem,
    sourceRef: projecao.raiz.source_ref,
    parseEvidence: projecao.raiz.parse_evidence,
    ...(projecao.raiz.supporting_source_refs.length > 0
      ? { supportingSourceRefs: [...projecao.raiz.supporting_source_refs] }
      : {}),
    titulo: lei.titulo,
    sigla: lei.sigla,
    tipoNorma: lei.tipo,
    numero: lei.numero,
    ano: lei.ano,
    ramo: lei.ramo,
    fonte: lei.fonte_url,
    dataPublicacao: lei.data_publicacao,
    dataAtualizacaoLegal: versao.data_atualizacao_legal,
    dataFormatacaoVinculex: versao.data_formatacao_vinculex,
    totalArtigos: versao.total_artigos,
    versaoVinculex: versao.versao_vinculex,
    legalStatus: lei.legal_status,
    publicationStatus: lei.publication_status,
    dataVerificacaoIntegridade: versao.data_verificacao_integridade,
    ...(versao.tags.length > 0 ? { tags: [...versao.tags] } : {}),
    // A coluna é sempre presente e anulável, então a volta sempre emite o
    // campo. Uma árvore que vinha sem ele volta com `null`: os dois dizem "não
    // revogada", e normalizar uma vez é melhor que carregar a distinção entre
    // ausente e nulo por todo o pipeline.
    revogadaPor: versao.revogada_por,
    ...(versao.redacoes_dadas_por.length > 0
      ? { redacoesDadasPor: [...versao.redacoes_dadas_por] }
      : {}),
    ...(versao.ids_depreciados.length > 0 ? { idsDepreciados: [...versao.ids_depreciados] } : {}),
    ...(versao.fontes_secundarias.length > 0
      ? { fontesSecundarias: [...versao.fontes_secundarias] }
      : {}),
    ...(versao.avisos_atualizacao.length > 0
      ? { avisosAtualizacao: [...versao.avisos_atualizacao] }
      : {}),
    ...(versao.notas_editoriais.length > 0
      ? { notasEditoriais: [...versao.notas_editoriais] }
      : {}),
    children: raizes,
  };

  const analise = identifiedNormaAstSchema.safeParse(arvore);

  if (!analise.success) {
    return falha([
      criarProblema(
        'schema_invalido',
        ['dispositivos'],
        'A árvore reconstruída da projeção não satisfaz o contrato da fase identified.',
      ),
    ]);
  }

  return sucesso(analise.data);
};
