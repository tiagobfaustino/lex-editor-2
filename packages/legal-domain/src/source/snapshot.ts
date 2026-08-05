// Conjunto de fontes de uma importação (ADR-009).
//
// O domínio monta e valida o conjunto; quem lê arquivo e calcula SHA-256 é a
// CLI. Fosse diferente, o pacote precisaria de `node:fs` e `node:crypto` e
// deixaria de ser puro — a fronteira que a Feature 001 estabeleceu e a 002
// provou por teste.
//
// O snapshot é o artefato bruto preservado antes de qualquer limpeza, como
// manda o invariante da Feature 003. O que este módulo garante é que o
// conjunto tem exatamente uma fonte primária e que toda referência aponta para
// um snapshot declarado.

import { criarProblema, falha, type ResultadoValidacao, sucesso } from '../ast/errors.js';
import type { SourceReference } from '../ast/nodes.js';
import { sourceReferenceSchema } from '../ast/schemas.js';

/**
 * Artefato bruto tal como capturado, com seu hash. `conteudo` é o texto
 * original: nenhuma limpeza aconteceu ainda.
 */
export interface SourceSnapshot {
  readonly sha256: string;
  readonly conteudo: string;
  readonly referencia: SourceReference;
}

export interface ConjuntoDeFontes {
  readonly primaria: SourceSnapshot;
  readonly complementares: readonly SourceSnapshot[];
}

/**
 * Monta o conjunto de fontes.
 *
 * A ADR-009 §1 exige exatamente uma `primary_current` por importação: é ela que
 * determina o texto vigente. Duas primárias significariam duas candidatas a
 * texto atual sem regra de precedência, e nenhuma fonte auxiliar pode substituir
 * silenciosamente a primária (§3).
 */
export const montarConjuntoDeFontes = (
  snapshots: readonly SourceSnapshot[],
): ResultadoValidacao<ConjuntoDeFontes> => {
  if (snapshots.length === 0) {
    return falha([criarProblema('entrada_vazia', [], 'O conjunto de fontes está vazio.')]);
  }

  const problemas = snapshots.flatMap((snapshot, indice) => {
    const analise = sourceReferenceSchema.safeParse(snapshot.referencia);

    if (!analise.success) {
      return [
        criarProblema(
          'schema_invalido',
          ['snapshots', indice, 'referencia'],
          'A referência de origem não satisfaz o contrato de SourceReference.',
        ),
      ];
    }

    if (snapshot.referencia.sourceArtifactSha256 !== snapshot.sha256) {
      return [
        criarProblema(
          'schema_invalido',
          ['snapshots', indice, 'referencia', 'sourceArtifactSha256'],
          'O hash da referência não corresponde ao hash do snapshot.',
        ),
      ];
    }

    return [];
  });

  if (problemas.length > 0) {
    return falha(problemas);
  }

  const primarias = snapshots.filter(
    (snapshot) => snapshot.referencia.sourceRole === 'primary_current',
  );

  if (primarias.length !== 1) {
    return falha([
      criarProblema(
        'manifesto_invalido',
        ['snapshots'],
        `A ADR-009 exige exatamente uma fonte primary_current; o conjunto tem ${String(primarias.length)}.`,
      ),
    ]);
  }

  const primaria = primarias[0];

  if (primaria === undefined) {
    return falha([criarProblema('manifesto_invalido', ['snapshots'], 'Fonte primária ausente.')]);
  }

  return sucesso({
    primaria,
    complementares: snapshots.filter((snapshot) => snapshot !== primaria),
  });
};

/**
 * Referência de um fragmento dentro do snapshot. As linhas localizam o trecho;
 * a garantia de integridade é o par de hashes, nunca o intervalo (ADR-009 §5).
 */
export const referenciarFragmento = (
  conjunto: ConjuntoDeFontes,
  linhaInicial: number,
  linhaFinal: number,
  fragmentSha256: string,
): SourceReference => ({
  ...conjunto.primaria.referencia,
  rawStartLine: linhaInicial,
  rawEndLine: linhaFinal,
  fragmentSha256,
});
