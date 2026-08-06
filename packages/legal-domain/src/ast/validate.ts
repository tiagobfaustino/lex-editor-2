// Validação estrutural da NormaAST.
//
// O `plan.md` da Feature 002 separa validação de forma (schema) de invariantes
// globais da árvore (aqui). O schema decide sobre um nó isolado; este módulo
// decide sobre relações que só existem quando a árvore inteira é percorrida:
// unicidade, ordem entre irmãos, hierarquia, ciclo e contagem derivada.
//
// O percurso aceita entrada não confiável. Um schema de runtime entra em
// recursão infinita diante de um ciclo de referências, então a detecção de
// ciclo precisa morar em um percurso próprio, iterativo, que possa ser
// executado antes ou depois do parse.

import { astPhaseSchema, type AstPhase, TIPOS_REFERENCIAVEIS } from './enums.js';
import {
  criarProblema,
  falha,
  LIMITE_PROBLEMAS,
  problemasDoZod,
  type ProblemaValidacao,
  type ResultadoValidacao,
  type SegmentoCaminho,
  sucesso,
} from './errors.js';
import type { IdentifiedNormaAST, ParsedNormaAST } from './nodes.js';
import { identifiedNormaAstSchema, parsedNormaAstSchema } from './schemas.js';

/**
 * Hierarquia permitida, transcrita de `DATA_MODEL.md` §NormaAST. O schema já
 * recusa filho incompatível pelas uniões discriminadas; esta tabela existe para
 * que o validador funcione sozinho sobre uma árvore já tipada e para que a
 * hierarquia fique legível em um lugar só.
 */
const FILHOS_PERMITIDOS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  lei: ['livro', 'titulo', 'capitulo', 'artigo', 'anexo', 'tabela'],
  livro: ['titulo', 'capitulo', 'artigo'],
  titulo: ['capitulo', 'artigo', 'anexo', 'tabela'],
  capitulo: ['secao', 'artigo'],
  secao: ['subsecao', 'artigo'],
  subsecao: ['artigo'],
  artigo: ['paragrafo', 'inciso', 'alinea', 'pena'],
  paragrafo: ['inciso', 'alinea', 'pena'],
  inciso: ['alinea', 'pena'],
  alinea: ['item', 'pena'],
  item: ['pena'],
  pena: [],
  anexo: ['artigo', 'tabela'],
  tabela: [],
});

/** Campos de texto normativo obrigatório por tipo de nó. */
const TEXTO_OBRIGATORIO_POR_TIPO: Readonly<Record<string, readonly string[]>> = Object.freeze({
  lei: ['titulo', 'sigla', 'numero', 'ramo'],
  livro: ['titulo'],
  titulo: ['titulo'],
  capitulo: ['titulo'],
  secao: ['titulo'],
  subsecao: ['titulo'],
  artigo: ['numero', 'caput'],
  paragrafo: ['numero', 'texto'],
  inciso: ['numero', 'texto'],
  alinea: ['letra', 'texto'],
  item: ['numero', 'texto'],
  pena: ['texto'],
  anexo: ['numero', 'titulo'],
  tabela: ['numero', 'caption'],
});

const REFERENCIAVEIS: ReadonlySet<string> = new Set(TIPOS_REFERENCIAVEIS);

type NoDesconhecido = Record<string, unknown>;

const ehObjeto = (valor: unknown): valor is NoDesconhecido =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

const textoVazio = (valor: unknown): boolean =>
  typeof valor !== 'string' || valor.trim().length === 0;

interface Visita {
  readonly no: NoDesconhecido;
  readonly caminho: readonly SegmentoCaminho[];
  readonly tipoDoPai: string | undefined;
}

/**
 * Percorre a árvore em profundidade, sem recursão, entregando cada nó com seu
 * caminho e o tipo do pai.
 *
 * `onCiclo` é chamado quando a mesma referência de objeto reaparece no
 * percurso. Sem isso, uma árvore com ciclo — vinda de código, não de JSON —
 * travaria o processo em vez de virar erro de validação.
 */
export const percorrer = (
  raiz: unknown,
  aoVisitar: (visita: Visita) => void,
  aoDetectarCiclo: (caminho: readonly SegmentoCaminho[]) => void,
): void => {
  if (!ehObjeto(raiz)) {
    return;
  }

  const vistos = new WeakSet<NoDesconhecido>();
  const pilha: Visita[] = [{ no: raiz, caminho: [], tipoDoPai: undefined }];

  while (pilha.length > 0) {
    const visita = pilha.pop();

    if (visita === undefined) {
      break;
    }

    if (vistos.has(visita.no)) {
      aoDetectarCiclo(visita.caminho);
      continue;
    }

    vistos.add(visita.no);
    aoVisitar(visita);

    const filhos = visita.no['children'];

    if (!Array.isArray(filhos)) {
      continue;
    }

    const tipo = typeof visita.no['tipo'] === 'string' ? visita.no['tipo'] : undefined;

    // Empilha ao contrário para que a visita siga a ordem declarada; o caminho
    // reportado precisa bater com o índice real do array.
    for (let indice = filhos.length - 1; indice >= 0; indice -= 1) {
      const filho: unknown = filhos[indice];

      if (ehObjeto(filho)) {
        pilha.push({
          no: filho,
          caminho: [...visita.caminho, 'children', indice],
          tipoDoPai: tipo,
        });
      }
    }
  }
};

/**
 * Invariantes que só a árvore inteira revela. Devolve a lista de problemas;
 * vazia significa árvore íntegra.
 */
export const validarEstrutura = (raiz: unknown, fase: AstPhase): readonly ProblemaValidacao[] => {
  const problemas: ProblemaValidacao[] = [];
  const idsVistos = new Map<string, readonly SegmentoCaminho[]>();
  const blockIdsVistos = new Map<string, readonly SegmentoCaminho[]>();
  let artigosContados = 0;

  const registrar = (problema: ProblemaValidacao): void => {
    if (problemas.length < LIMITE_PROBLEMAS) {
      problemas.push(problema);
    }
  };

  if (!ehObjeto(raiz)) {
    return [criarProblema('schema_invalido', [], 'A raiz da NormaAST precisa ser um objeto.')];
  }

  const faseDeclarada = raiz['astPhase'];

  if (faseDeclarada !== fase) {
    registrar(
      criarProblema(
        'fase_incompativel',
        ['astPhase'],
        `A raiz declara astPhase ${JSON.stringify(faseDeclarada)}, mas foi validada como "${fase}".`,
      ),
    );
  }

  percorrer(
    raiz,
    ({ no, caminho, tipoDoPai }) => {
      const tipo = typeof no['tipo'] === 'string' ? no['tipo'] : undefined;
      const id = typeof no['id'] === 'string' ? no['id'] : undefined;

      if (tipo === undefined) {
        registrar(criarProblema('schema_invalido', [...caminho, 'tipo'], 'Nó sem discriminante.'));
        return;
      }

      if (tipo === 'artigo') {
        artigosContados += 1;
      }

      // --- Hierarquia ---
      if (tipoDoPai !== undefined) {
        const permitidos = FILHOS_PERMITIDOS[tipoDoPai] ?? [];

        if (!permitidos.includes(tipo)) {
          registrar(
            criarProblema(
              'filho_incompativel',
              caminho,
              `"${tipo}" não é filho válido de "${tipoDoPai}".`,
              id,
            ),
          );
        }
      }

      // --- Unicidade do id interno ---
      if (id !== undefined) {
        const anterior = idsVistos.get(id);

        if (anterior === undefined) {
          idsVistos.set(id, caminho);
        } else {
          registrar(
            criarProblema(
              'id_duplicado',
              [...caminho, 'id'],
              `O id interno "${id}" já é usado em /${anterior.join('/')}.`,
              id,
            ),
          );
        }
      }

      // --- Block ID: presença por fase e unicidade ---
      const blockId = no['blockId'];
      const referenciavel = REFERENCIAVEIS.has(tipo);

      if (fase === 'parsed' && blockId !== undefined) {
        registrar(
          criarProblema(
            'block_id_proibido',
            [...caminho, 'blockId'],
            'A fase parsed não admite Block ID em nenhum nó.',
            id,
          ),
        );
      }

      if (fase === 'identified' && referenciavel && blockId === undefined) {
        registrar(
          criarProblema(
            'block_id_ausente',
            [...caminho, 'blockId'],
            `"${tipo}" é referenciável e exige Block ID na fase identified.`,
            id,
          ),
        );
      }

      if (tipo === 'lei' && blockId !== undefined) {
        registrar(
          criarProblema(
            'block_id_proibido',
            [...caminho, 'blockId'],
            'A raiz não possui Block ID.',
            id,
          ),
        );
      }

      if (typeof blockId === 'string') {
        const anterior = blockIdsVistos.get(blockId);

        if (anterior === undefined) {
          blockIdsVistos.set(blockId, caminho);
        } else {
          registrar(
            criarProblema(
              'block_id_duplicado',
              [...caminho, 'blockId'],
              `O Block ID "${blockId}" já é usado em /${anterior.join('/')}.`,
              id,
            ),
          );
        }
      }

      // --- Texto normativo obrigatório ---
      for (const campo of TEXTO_OBRIGATORIO_POR_TIPO[tipo] ?? []) {
        if (textoVazio(no[campo])) {
          registrar(
            criarProblema(
              'texto_obrigatorio',
              [...caminho, campo],
              `"${campo}" de "${tipo}" não pode ser vazio.`,
              id,
            ),
          );
        }
      }

      // --- Revogação (RF-002-03) ---
      const revogado = no['deviceStatus'] === 'revoked';
      const decidido = no['preservarTextoRevogado'] !== undefined;

      if (tipo !== 'lei') {
        if (revogado && !decidido) {
          registrar(
            criarProblema(
              'revogacao_sem_decisao',
              [...caminho, 'preservarTextoRevogado'],
              'deviceStatus "revoked" exige a decisão explícita preservarTextoRevogado.',
              id,
            ),
          );
        }

        if (!revogado && decidido) {
          registrar(
            criarProblema(
              'preservacao_sem_revogacao',
              [...caminho, 'preservarTextoRevogado'],
              'preservarTextoRevogado só existe quando deviceStatus é "revoked".',
              id,
            ),
          );
        }
      }

      // --- Tabela: contagem coerente de colunas ---
      if (tipo === 'tabela') {
        const headers = no['headers'];
        const rows = no['rows'];

        if (Array.isArray(headers) && Array.isArray(rows)) {
          rows.forEach((linha: unknown, indice) => {
            if (Array.isArray(linha) && linha.length !== headers.length) {
              registrar(
                criarProblema(
                  'tabela_irregular',
                  [...caminho, 'rows', indice],
                  `A linha ${String(indice)} tem ${String(linha.length)} célula(s); headers define ${String(headers.length)}.`,
                  id,
                ),
              );
            }
          });
        }
      }

      // --- Ordem única entre irmãos ---
      const filhos = no['children'];

      if (Array.isArray(filhos)) {
        const ordensVistas = new Map<number, number>();

        filhos.forEach((filho: unknown, indice) => {
          if (!ehObjeto(filho)) {
            return;
          }

          const ordem = filho['ordem'];

          if (typeof ordem !== 'number') {
            return;
          }

          const anterior = ordensVistas.get(ordem);

          if (anterior === undefined) {
            ordensVistas.set(ordem, indice);
          } else {
            registrar(
              criarProblema(
                'ordem_duplicada',
                [...caminho, 'children', indice, 'ordem'],
                `A ordem ${String(ordem)} já é usada pelo irmão de índice ${String(anterior)}.`,
                typeof filho['id'] === 'string' ? filho['id'] : undefined,
              ),
            );
          }
        });
      }
    },
    (caminho) => {
      registrar(
        criarProblema('ciclo', caminho, 'A árvore referencia um nó já visitado neste percurso.'),
      );
    },
  );

  // --- Contagem derivada ---
  // `totalArtigos` é derivado dos children e validado antes do Formatter
  // (DATA_MODEL §Nó raiz). Deixá-lo divergir seria publicar um número errado no
  // frontmatter sem nada acusar.
  const totalDeclarado = raiz['totalArtigos'];

  if (typeof totalDeclarado === 'number' && totalDeclarado !== artigosContados) {
    registrar(
      criarProblema(
        'total_artigos_divergente',
        ['totalArtigos'],
        `A raiz declara ${String(totalDeclarado)} artigo(s), mas a árvore tem ${String(artigosContados)}.`,
      ),
    );
  }

  return Object.freeze(problemas);
};

/**
 * Fluxo completo do `plan.md`: `unknown → schema de fase → AST tipada →
 * validação estrutural → resultado`. O schema roda primeiro porque garante a
 * forma de que o percurso depende.
 */
const validarFase = <T>(
  entrada: unknown,
  schema: { safeParse: (valor: unknown) => { success: boolean; data?: unknown; error?: unknown } },
  fase: AstPhase,
): ResultadoValidacao<T> => {
  const analise = schema.safeParse(entrada);

  if (!analise.success) {
    return falha(problemasDoZod(analise.error as Parameters<typeof problemasDoZod>[0]));
  }

  const estruturais = validarEstrutura(analise.data, fase);

  if (estruturais.length > 0) {
    return falha(estruturais);
  }

  return sucesso(analise.data as T);
};

/** Valida a saída do Parser: nenhum dispositivo possui Block ID. */
export const validarParsedNormaAst = (entrada: unknown): ResultadoValidacao<ParsedNormaAST> =>
  validarFase<ParsedNormaAST>(entrada, parsedNormaAstSchema, 'parsed');

/** Valida a saída do reconciliador: todo nó referenciável possui Block ID. */
export const validarIdentifiedNormaAst = (
  entrada: unknown,
): ResultadoValidacao<IdentifiedNormaAST> =>
  validarFase<IdentifiedNormaAST>(entrada, identifiedNormaAstSchema, 'identified');

/**
 * Valida contra a fase declarada na própria raiz. Conveniência para quem recebe
 * uma árvore de origem desconhecida; quem produz efeito jurídico deve exigir a
 * fase explicitamente.
 */
export const validarNormaAst = (
  entrada: unknown,
): ResultadoValidacao<ParsedNormaAST | IdentifiedNormaAST> => {
  const fase = ehObjeto(entrada) ? astPhaseSchema.safeParse(entrada['astPhase']) : undefined;

  if (fase?.success !== true) {
    return falha([
      criarProblema(
        'fase_incompativel',
        ['astPhase'],
        'A raiz precisa declarar astPhase como "parsed" ou "identified".',
      ),
    ]);
  }

  return fase.data === 'parsed'
    ? validarParsedNormaAst(entrada)
    : validarIdentifiedNormaAst(entrada);
};
