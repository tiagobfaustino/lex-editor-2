// Mesclagem de fontes oficiais conforme ADR-009 e ADR-011.

import {
  criarProblema,
  falha,
  type ProblemaValidacao,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { ParsedNormaAST, SourceReference, ParseEvidence } from '../ast/nodes.js';
import { validarParsedNormaAst } from '../ast/validate.js';

type No = Record<string, unknown>;

const filhos = (no: No): No[] => (Array.isArray(no['children']) ? (no['children'] as No[]) : []);
const normalizar = (texto: string): string => texto.replace(/\s+/gu, ' ').trim();

const copiar = (valor: unknown): unknown => {
  if (Array.isArray(valor)) return valor.map(copiar);
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, copiar(item)]));
  }
  return valor;
};

const textoVigente = (no: No): string | undefined => {
  for (const campo of ['caput', 'texto', 'titulo', 'caption'] as const) {
    if (typeof no[campo] === 'string') return normalizar(no[campo]);
  }
  return undefined;
};

const chaveDaReferencia = (ref: SourceReference): string =>
  `${ref.sourceArtifactSha256}:${ref.fragmentSha256}`;

const referenciasUnicas = (refs: readonly SourceReference[]): SourceReference[] => {
  const vistas = new Set<string>();
  return refs.filter((ref) => {
    const chave = chaveDaReferencia(ref);
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
};

const segmento = (no: No, indice: number): string => {
  const tipo = String(no['tipo']);
  const identidade = no['numero'] ?? no['letra'];
  if (typeof identidade === 'string' && identidade.length > 0) return `${tipo}:${identidade}`;
  if (tipo === 'ato_transitorio') return tipo;
  if (typeof no['titulo'] === 'string') return `${tipo}:${normalizar(no['titulo']).toLowerCase()}`;
  return `${tipo}:@${String(indice)}`;
};

const indexar = (raiz: No): Map<string, No[]> => {
  const mapa = new Map<string, No[]>();
  const visitar = (no: No, caminho: string): void => {
    mapa.set(caminho, [...(mapa.get(caminho) ?? []), no]);
    filhos(no).forEach((filho, indice) => {
      visitar(filho, `${caminho}/${segmento(filho, indice)}`);
    });
  };
  visitar(raiz, 'lei');
  return mapa;
};

const numerosDeArtigos = (no: No): readonly string[] =>
  no['tipo'] === 'artigo' ? [String(no['numero'])] : filhos(no).flatMap(numerosDeArtigos);

const redacoesUnicas = (valores: readonly unknown[]): unknown[] => {
  const vistas = new Set<string>();
  return valores.filter((valor) => {
    const chave = JSON.stringify(valor);
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
};

const sinalizarConflito = (
  alvo: No,
  origem: No,
  caminho: string,
  fonte: string,
  ambiguo = false,
): void => {
  const evidence = alvo['parseEvidence'] as ParseEvidence;
  alvo['parseEvidence'] = {
    confidence: 'low',
    reasons: [...new Set([...evidence.reasons, 'source_text_conflict' as const])],
    requiresHumanReview: true,
    editorialNote: [
      evidence.editorialNote,
      `${ambiguo ? 'Correspondência ambígua entre divisões' : 'Conflito de fontes'} em ${caminho}. Texto da fonte primária: ${textoVigente(alvo) ?? '(sem texto)'} Texto da auxiliar (${fonte}): ${textoVigente(origem) ?? '(sem texto)'}. Confira os snapshots antes de confirmar a primária; o histórico deste trecho auxiliar não foi mesclado.`,
    ]
      .filter(Boolean)
      .join('\n'),
  } satisfies ParseEvidence;
  alvo['supportingSourceRefs'] = referenciasUnicas([
    ...((alvo['supportingSourceRefs'] as SourceReference[] | undefined) ?? []),
    origem['sourceRef'] as SourceReference,
  ]);
};

export interface OpcoesDeMesclagem {
  /** Produz candidata revisável; conflitos bloqueiam aprovação pela evidência de baixa confiança. */
  readonly permitirConflitosParaRevisao?: boolean;
  /**
   * Caminhos cuja divergência foi revisada fora do parser. A fonte primária é
   * mantida e o nó auxiliar conflitante não contribui histórico nem estado.
   */
  readonly conflitosRevisados?: readonly string[];
}

/**
 * Preserva integralmente a árvore primária e agrega somente evidência e
 * histórico de nós estruturalmente correspondentes nas fontes auxiliares.
 */
export const mesclarFontes = (
  primaria: ParsedNormaAST,
  auxiliares: readonly ParsedNormaAST[],
  opcoes: OpcoesDeMesclagem = {},
): ResultadoValidacao<ParsedNormaAST> => {
  const primariaValida = validarParsedNormaAst(primaria);
  if (!primariaValida.ok) return primariaValida;

  const problemas: ProblemaValidacao[] = [];
  const copia = copiar(primaria) as ParsedNormaAST;
  const destino = indexar(copia as unknown as No);

  auxiliares.forEach((auxiliar, indiceAuxiliar) => {
    const valida = validarParsedNormaAst(auxiliar);
    if (!valida.ok) {
      problemas.push(...valida.problemas);
      return;
    }

    for (const [caminho, origens] of indexar(auxiliar as unknown as No)) {
      for (const origem of origens) {
        const candidatos = destino.get(caminho) ?? [];
        if (candidatos.length === 0) continue;
        const porTexto = candidatos.filter((no) => textoVigente(no) === textoVigente(origem));
        const artigosOrigem = new Set(numerosDeArtigos(origem));
        const correspondentes =
          candidatos.length === 1
            ? candidatos
            : porTexto.length === 1
              ? porTexto
              : candidatos.filter((no) =>
                  numerosDeArtigos(no).some((numero) => artigosOrigem.has(numero)),
                );
        const alvo = correspondentes.length === 1 ? correspondentes[0] : undefined;
        if (alvo === undefined) {
          if (opcoes.permitirConflitosParaRevisao === true) {
            for (const candidato of candidatos)
              sinalizarConflito(candidato, origem, caminho, auxiliar.fonte, true);
            continue;
          }
          problemas.push(
            criarProblema(
              'conflito_de_fontes',
              ['auxiliares', indiceAuxiliar, caminho],
              `O caminho ${caminho} identifica mais de uma divisão e não permite correspondência única entre fontes.`,
            ),
          );
          continue;
        }

        const atual = textoVigente(alvo);
        const complementar = textoVigente(origem);
        if (atual !== undefined && complementar !== undefined && atual !== complementar) {
          if (opcoes.conflitosRevisados?.includes(caminho) === true) continue;
          if (opcoes.permitirConflitosParaRevisao === true) {
            sinalizarConflito(alvo, origem, caminho, auxiliar.fonte);
            continue;
          }
          problemas.push(
            criarProblema(
              'conflito_de_fontes',
              ['auxiliares', indiceAuxiliar, caminho],
              `A fonte auxiliar diverge do texto vigente da fonte primary_current em ${caminho}.`,
              typeof alvo['id'] === 'string' ? alvo['id'] : undefined,
            ),
          );
          continue;
        }

        const refOrigem = origem['sourceRef'] as SourceReference;
        const suporteOrigem = Array.isArray(origem['supportingSourceRefs'])
          ? (origem['supportingSourceRefs'] as SourceReference[])
          : [];
        const suporteAlvo = Array.isArray(alvo['supportingSourceRefs'])
          ? (alvo['supportingSourceRefs'] as SourceReference[])
          : [];
        alvo['supportingSourceRefs'] = referenciasUnicas([
          ...suporteAlvo,
          refOrigem,
          ...suporteOrigem,
        ]);

        const anterioresAlvo: unknown[] = Array.isArray(alvo['redacoesAnteriores'])
          ? (alvo['redacoesAnteriores'] as unknown[])
          : [];
        const anterioresOrigem: unknown[] = Array.isArray(origem['redacoesAnteriores'])
          ? (origem['redacoesAnteriores'] as unknown[])
          : [];
        const anteriores = [...anterioresAlvo, ...anterioresOrigem];
        if (anteriores.length > 0) alvo['redacoesAnteriores'] = redacoesUnicas(anteriores);

        for (const campo of [
          'notaStatus',
          'preservarTextoRevogado',
          'redacaoAtualDadaPor',
        ] as const) {
          if (alvo[campo] === undefined && origem[campo] !== undefined) alvo[campo] = origem[campo];
        }
      }
    }
  });

  if (problemas.length > 0) return falha(problemas);

  const urls = auxiliares.map((a) => a.fonte).filter((url) => url !== copia.fonte);
  copia.fontesSecundarias = [...new Set([...(copia.fontesSecundarias ?? []), ...urls])];
  return validarParsedNormaAst(copia).ok ? sucesso(copia) : validarParsedNormaAst(copia);
};
