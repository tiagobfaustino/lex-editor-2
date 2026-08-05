// Formatter Markdown/Obsidian canônico (MARKDOWN_SPEC.md).
//
// Determinismo é requisito, não qualidade desejável: a RF-003-01 exige os
// mesmos bytes para a mesma entrada, e a Feature 007 vai derivar o
// `conteudo_sha256` da publicação daqui. Por isso a §2.4 é seguida à risca —
// ordem fixa de campos, LF, sem espaço ao final de linha, exatamente uma
// newline final.
//
// O Formatter nunca consulta o relógio (invariante da Feature 003): toda data
// entra pela NormaAST, que por sua vez a recebeu do manifesto.

import { criarProblema, falha, type ResultadoValidacao, sucesso } from '../ast/errors.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { identifiedNormaAstSchema } from '../ast/schemas.js';

/** Dois espaços por nível, conforme §3.1. */
const INDENTACAO = '  ';

/** Profundidade de lista por tipo (§3.1). Pena fica um nível abaixo do pai. */
const NIVEL: Readonly<Record<string, number>> = {
  artigo: 0,
  paragrafo: 1,
  inciso: 2,
  alinea: 3,
  item: 4,
};

const HEADING: Readonly<Record<string, string>> = {
  livro: '#',
  titulo: '##',
  capitulo: '###',
  secao: '####',
  subsecao: '#####',
};

/**
 * Rótulo do heading. Escrito à mão porque capitalizar o discriminante daria
 * "Capitulo" e "Secao": o tipo do nó é um identificador sem acento, o texto
 * publicado é português.
 */
const ROTULO_DA_DIVISAO: Readonly<Record<string, string>> = {
  livro: 'Livro',
  titulo: 'Título',
  capitulo: 'Capítulo',
  secao: 'Seção',
  subsecao: 'Subseção',
};

const aspas = (valor: string): string => JSON.stringify(valor);

const listaEmLinha = (valores: readonly string[]): string => `[${valores.map(aspas).join(', ')}]`;

/**
 * Reconstrói o designador oficial a partir do nó. O parser guardou o número e
 * o texto separados; a serialização é responsabilidade daqui.
 */
const designador = (no: Record<string, unknown>): string => {
  const numero = typeof no['numero'] === 'string' ? no['numero'] : '';
  const texto = typeof no['texto'] === 'string' ? no['texto'] : '';

  switch (no['tipo']) {
    case 'artigo': {
      const caput = typeof no['caput'] === 'string' ? no['caput'] : '';

      return `Art. ${numero}. ${caput}`;
    }
    case 'paragrafo':
      return numero === 'unico' ? `Parágrafo único. ${texto}` : `§ ${numero}º ${texto}`;
    case 'inciso':
      return `${numero.toUpperCase()} - ${texto}`;
    case 'alinea': {
      const letra = typeof no['letra'] === 'string' ? no['letra'] : '';

      return `${letra}) ${texto}`;
    }
    case 'item':
      return `${numero}. ${texto}`;
    case 'pena':
      return texto;
    default:
      return texto;
  }
};

/**
 * Aplica a sinalização de revogado/vetado da §5.
 *
 * A §5.3 é categórica: o riscado só entra quando `preservarTextoRevogado` for
 * `true`. Com `false`, o texto residual oficial é reproduzido como está, sem
 * itálico acrescentado — a decisão vem da NormaAST, nunca de inferência do
 * Formatter sobre o texto.
 */
const comSinalizacao = (no: Record<string, unknown>, linha: string): string => {
  const estado = no['deviceStatus'];
  const nota = typeof no['notaStatus'] === 'string' ? no['notaStatus'] : '';

  if (estado === 'revoked') {
    return no['preservarTextoRevogado'] === true
      ? `~~${linha}~~${nota.length > 0 ? ` *${nota}*` : ''}`
      : linha;
  }

  if (estado === 'vetoed') {
    return nota.length > 0 ? linha : `${linha} *(Vetado)*`;
  }

  return linha;
};

/**
 * Linhas de histórico da ADR-006: riscadas, na mesma indentação, imediatamente
 * acima da redação vigente e **sem** Block ID.
 */
const historico = (no: Record<string, unknown>, recuo: string): string[] => {
  const redacoes = no['redacoesAnteriores'];

  if (!Array.isArray(redacoes)) {
    return [];
  }

  return redacoes.map((redacao: unknown) => {
    const entrada = redacao as { texto?: unknown; nota?: unknown };
    const texto = typeof entrada.texto === 'string' ? entrada.texto : '';
    const nota = typeof entrada.nota === 'string' ? entrada.nota : '';

    return `${recuo}- ~~${texto}~~ *${nota}*`;
  });
};

const serializarNo = (no: Record<string, unknown>, nivelDoPai: number): string[] => {
  const tipo = typeof no['tipo'] === 'string' ? no['tipo'] : '';
  const filhos = Array.isArray(no['children']) ? (no['children'] as Record<string, unknown>[]) : [];

  if (HEADING[tipo] !== undefined) {
    const numero = typeof no['numero'] === 'string' ? no['numero'] : '';
    const titulo = typeof no['titulo'] === 'string' ? no['titulo'] : '';
    const rotulo = ROTULO_DA_DIVISAO[tipo] ?? tipo;
    // §7.3: divisão não recebe Block ID por padrão. Quando ele existir — a
    // extensão opcional da §7.4 —, vai ao final da linha como em qualquer
    // outro nó referenciável.
    const blockIdDaDivisao = typeof no['blockId'] === 'string' ? ` ^${no['blockId']}` : '';
    const cabecalho = `${HEADING[tipo] ?? ''} ${rotulo}${numero.length > 0 ? ` ${numero}` : ''} - ${titulo}${blockIdDaDivisao}`;

    return [cabecalho, '', ...filhos.flatMap((filho) => serializarNo(filho, 0))];
  }

  // Pena fica exatamente um nível abaixo do dispositivo a que pertence (§3.1).
  const nivel = tipo === 'pena' ? nivelDoPai + 1 : (NIVEL[tipo] ?? nivelDoPai + 1);
  const recuo = INDENTACAO.repeat(nivel);
  const blockId = typeof no['blockId'] === 'string' ? no['blockId'] : '';
  const corpo = comSinalizacao(no, designador(no));

  // §4: exatamente um espaço antes do `^id`, que é o último token da linha.
  const linha = `${recuo}- ${corpo} ^${blockId}`;

  return [...historico(no, recuo), linha, ...filhos.flatMap((filho) => serializarNo(filho, nivel))];
};

const frontmatter = (raiz: IdentifiedNormaAST): string[] => {
  const linhas = [
    '---',
    `title: ${aspas(raiz.titulo)}`,
    `sigla: ${aspas(raiz.sigla)}`,
    `tipo: ${aspas(raiz.tipoNorma)}`,
    `numero: ${aspas(raiz.numero)}`,
    `ano: ${String(raiz.ano)}`,
    `ramo: ${aspas(raiz.ramo)}`,
    `fonte: ${aspas(raiz.fonte)}`,
    `data_publicacao: ${raiz.dataPublicacao}`,
    `data_atualizacao_legal: ${raiz.dataAtualizacaoLegal}`,
    `data_formatacao_vinculex: ${raiz.dataFormatacaoVinculex}`,
    `total_artigos: ${String(raiz.totalArtigos)}`,
    `versao_vinculex: ${aspas(raiz.versaoVinculex)}`,
    `legal_status: ${aspas(raiz.legalStatus)}`,
  ];

  // §2.4 regra 2: os opcionais vêm depois, na ordem da §2.2.
  if (raiz.tags !== undefined) {
    linhas.push(`tags: ${listaEmLinha(raiz.tags)}`);
  }

  if (raiz.revogadaPor !== undefined) {
    linhas.push(`revogada_por: ${raiz.revogadaPor === null ? 'null' : aspas(raiz.revogadaPor)}`);
  }

  if (raiz.redacoesDadasPor !== undefined) {
    linhas.push('redacao_dada_por:');

    for (const referencia of raiz.redacoesDadasPor) {
      linhas.push(
        `  - block_id: ${aspas(referencia.blockId)}`,
        `    lei: ${aspas(referencia.lei)}`,
        `    data: ${referencia.data}`,
        `    descricao: ${aspas(referencia.descricao)}`,
      );
    }
  }

  if (raiz.idsDepreciados !== undefined) {
    linhas.push('ids_depreciados:');

    for (const alias of raiz.idsDepreciados) {
      linhas.push(`  - antigo: ${aspas(alias.antigo)}`, `    novo: ${aspas(alias.novo)}`);
    }
  }

  if (raiz.fontesSecundarias !== undefined) {
    linhas.push(`fonte_secundaria: ${listaEmLinha(raiz.fontesSecundarias)}`);
  }

  linhas.push('---');

  return linhas;
};

/**
 * Callouts do cabeçalho (§6). `[!info]` e `[!caution]` são obrigatórios em todo
 * arquivo; `[!warning]` é obrigatório quando `legal_status` não é `vigente`.
 */
const callouts = (raiz: IdentifiedNormaAST): string[] => {
  const blocos: string[][] = [
    [
      '> [!info] Fonte Oficial',
      `> Texto compilado a partir de ${raiz.fonte}. Última verificação de integridade em ${raiz.dataVerificacaoIntegridade}.`,
    ],
  ];

  if (raiz.legalStatus !== 'vigente') {
    blocos.push([
      '> [!warning] Atualização',
      `> Esta norma está com legal_status "${raiz.legalStatus}". Consulte a fonte oficial antes de qualquer uso.`,
    ]);
  }

  for (const aviso of raiz.avisosAtualizacao ?? []) {
    blocos.push(['> [!warning] Atualização', `> ${aviso}`]);
  }

  blocos.push([
    '> [!caution] Aviso de Segurança Jurídica',
    '> Este material é destinado a fins de estudo. O texto pode ter sofrido alterações após a publicação desta versão. Não deve ser utilizado como fonte para peticionamento ou decisão jurídica sem confirmação na fonte oficial.',
  ]);

  for (const nota of raiz.notasEditoriais ?? []) {
    blocos.push(['> [!note] Nota Editorial', `> ${nota}`]);
  }

  // §2.4 regra 8: exatamente uma linha vazia entre cada callout.
  return blocos.flatMap((bloco) => [...bloco, '']);
};

/**
 * Serializa uma `IdentifiedNormaAST` em Markdown canônico.
 *
 * A RF-003-04 e a §9 regra 13 exigem que só a fase identificada chegue aqui: o
 * schema é reexecutado como defesa em profundidade, e não por desconfiança do
 * estágio anterior — uma `ParsedNormaAST` serializada seria um arquivo sem
 * Block ID nenhum, publicável e irreferenciável.
 */
export const formatar = (arvore: unknown): ResultadoValidacao<string> => {
  const analise = identifiedNormaAstSchema.safeParse(arvore);

  if (!analise.success) {
    return falha([
      criarProblema(
        'formatter_exige_identified',
        [],
        'O Formatter só aceita uma IdentifiedNormaAST válida; a árvore recebida não satisfaz o schema da fase.',
      ),
    ]);
  }

  const raiz = analise.data;
  const filhos = raiz.children as unknown as Record<string, unknown>[];

  const corpo: string[] = [];

  filhos.forEach((filho, indice) => {
    if (indice > 0) {
      corpo.push('');
    }

    corpo.push(...serializarNo(filho, 0));
  });

  const linhas = [...frontmatter(raiz), '', ...callouts(raiz), ...corpo];

  // §2.4 regras 6 e 7: sem espaço ao final de linha, LF, exatamente uma newline
  // no fim do documento.
  const texto = linhas.map((linha) => linha.replace(/[ \t]+$/u, '')).join('\n');

  return sucesso(`${texto.replace(/\n+$/u, '')}\n`);
};
