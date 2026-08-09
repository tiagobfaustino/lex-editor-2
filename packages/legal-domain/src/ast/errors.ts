// Erros do domínio jurídico.
//
// O plano da Feature 002 exige código estável e caminho do nó, sem depender da
// mensagem textual do validador subjacente: mensagens de biblioteca mudam entre
// versões e são texto de apresentação, enquanto um consumidor — Preview,
// validação bloqueante de publicação, worker de atualização — precisa decidir
// com base em algo que não muda.

import { z } from 'zod';

/**
 * Códigos estáveis. Um valor aqui é contrato público: renomeá-lo é mudança
 * quebrante para quem trata o erro programaticamente.
 */
export const CODIGOS_PROBLEMA = [
  /** Forma rejeitada pelo schema de runtime (tipo, enum, formato, campo extra). */
  'schema_invalido',
  /** Dois nós compartilham o mesmo `id` interno de runtime. */
  'id_duplicado',
  /** Dois irmãos declaram a mesma `ordem`. */
  'ordem_duplicada',
  /** O mesmo Block ID aparece em mais de um nó. */
  'block_id_duplicado',
  /** Fase `identified` sem Block ID em nó referenciável. */
  'block_id_ausente',
  /** Fase `parsed` com Block ID presente. */
  'block_id_proibido',
  /** Block ID fora da forma canônica de `BLOCK_ID_SPEC.md` §2.3. */
  'block_id_nao_canonico',
  /** Filho não permitido pela hierarquia do tipo do pai. */
  'filho_incompativel',
  /** A árvore referencia um nó já visitado no mesmo percurso. */
  'ciclo',
  /** `deviceStatus: 'revoked'` sem `preservarTextoRevogado` (RF-002-03). */
  'revogacao_sem_decisao',
  /** `preservarTextoRevogado` presente fora de `deviceStatus: 'revoked'`. */
  'preservacao_sem_revogacao',
  /** Linha de tabela com contagem de células diferente de `headers`. */
  'tabela_irregular',
  /** Texto normativo obrigatório vazio ou só com espaços. */
  'texto_obrigatorio',
  /** Confiança `low` sem `requiresHumanReview: true`. */
  'confianca_baixa_sem_revisao',
  /** `totalArtigos` diverge da contagem real de nós `artigo`. */
  'total_artigos_divergente',
  /** `astPhase` da raiz não corresponde à fase validada. */
  'fase_incompativel',

  // --- Pipeline (Feature 003) ---
  /** Entrada vazia ou só com espaços. */
  'entrada_vazia',
  /** Linha que não corresponde a nenhum designador suportado. */
  'designador_desconhecido',
  /** Designador válido sem um pai que possa recebê-lo, ex.: inciso sem artigo. */
  'dispositivo_orfao',
  /** Metadados obrigatórios ausentes ou malformados no manifesto da fixture. */
  'manifesto_invalido',
  /** O Formatter recebeu algo que não é uma `IdentifiedNormaAST`. */
  'formatter_exige_identified',
  /** Fontes oficiais divergem sobre texto vigente do mesmo dispositivo. */
  'conflito_de_fontes',
  /** Decisão editorial não corresponde exatamente ao fragmento revisado. */
  'decisao_editorial_invalida',
  /** Nota de estado contradiz o `deviceStatus` estruturado. */
  'estado_incompativel',
] as const;

export type CodigoProblema = (typeof CODIGOS_PROBLEMA)[number];

/** Segmento de caminho: chave de objeto ou índice de array. */
export type SegmentoCaminho = string | number;

export interface ProblemaValidacao {
  readonly codigo: CodigoProblema;
  /** Caminho do valor a partir da raiz, ex.: `['children', 0, 'blockId']`. */
  readonly caminho: readonly SegmentoCaminho[];
  /** Descrição acionável. É apresentação: não decida com base nela. */
  readonly mensagem: string;
  /** `id` interno do nó onde o problema foi detectado, quando conhecido. */
  readonly noId?: string;
}

export type ResultadoValidacao<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly problemas: readonly ProblemaValidacao[] };

/**
 * Limite de problemas reportados. Uma árvore muito quebrada geraria milhares de
 * entradas e nenhuma delas seria lida; o corte mantém a saída utilizável e
 * previsível. `truncado` avisa que existem mais.
 */
export const LIMITE_PROBLEMAS = 50;

export const criarProblema = (
  codigo: CodigoProblema,
  caminho: readonly SegmentoCaminho[],
  mensagem: string,
  noId?: string,
): ProblemaValidacao =>
  Object.freeze({ codigo, caminho, mensagem, ...(noId === undefined ? {} : { noId }) });

/**
 * O caminho do zod é `PropertyKey[]` e pode conter símbolos, que não são
 * serializáveis nem endereçáveis por um consumidor. Ficam de fora.
 */
const caminhoSerializavel = (caminho: readonly PropertyKey[]): readonly SegmentoCaminho[] =>
  caminho.filter((segmento): segmento is string | number => typeof segmento !== 'symbol');

/**
 * Converte problemas do zod para o formato estável.
 *
 * O código semântico viaja em `params.codigo` das checagens próprias; quando
 * ausente, o problema é de forma pura e vira `schema_invalido`. É isso que
 * permite a um consumidor distinguir "tabela irregular" de "campo faltando"
 * sem inspecionar texto.
 */
export const problemasDoZod = (erro: z.ZodError): readonly ProblemaValidacao[] => {
  const problemas: ProblemaValidacao[] = [];

  for (const issue of erro.issues.slice(0, LIMITE_PROBLEMAS)) {
    const params =
      'params' in issue ? (issue.params as { codigo?: CodigoProblema } | undefined) : undefined;

    problemas.push(
      criarProblema(
        params?.codigo ?? 'schema_invalido',
        caminhoSerializavel(issue.path),
        issue.message,
      ),
    );
  }

  return Object.freeze(problemas);
};

export const falha = (problemas: readonly ProblemaValidacao[]): ResultadoValidacao<never> =>
  Object.freeze({
    ok: false as const,
    problemas: Object.freeze(problemas.slice(0, LIMITE_PROBLEMAS)),
  });

export const sucesso = <T>(valor: T): ResultadoValidacao<T> =>
  Object.freeze({ ok: true as const, valor });
