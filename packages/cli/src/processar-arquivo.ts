// Adaptador de I/O do comando `lex process`.
//
// Tudo que é decisão jurídica vive no domínio; aqui ficam as três coisas que
// ele não pode fazer por ser puro: ler o arquivo, calcular SHA-256 e gravar de
// forma atômica.

import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  type DecisaoEditorial,
  type MetadadosDaNorma,
  montarConjuntoDeFontes,
  processar,
  type ProblemaDeEtapa,
  type Relatorio,
  type SourceSnapshot,
} from '@lex-editor/legal-domain';

export const sha256 = (conteudo: string): string =>
  createHash('sha256').update(conteudo, 'utf8').digest('hex');

/**
 * Códigos de saída distintos por etapa, como o `plan.md` pede: um script que
 * chama a CLI precisa distinguir "entrada ruim" de "texto jurídico
 * inconsistente" sem interpretar mensagem.
 */
export const CODIGO_DE_SAIDA = {
  ok: 0,
  entrada: 2,
  parsing: 3,
  identificacao: 4,
  validacao: 4,
  formatacao: 5,
  escrita: 6,
} as const;

export interface ResultadoDoComando {
  readonly codigo: number;
  readonly relatorio: Relatorio;
  readonly markdown?: string;
}

interface Manifesto extends MetadadosDaNorma {
  readonly sourceType: 'planalto_html' | 'lexml_xml' | 'markdown' | 'local_file';
  readonly sourceRole: 'primary_current' | 'historical_auxiliary' | 'cross_check';
  readonly sourceVariant: 'compiled' | 'annotated' | 'other';
}

const problemaDeEntrada = (mensagem: string): ProblemaDeEtapa => ({
  etapa: 'entrada',
  codigo: 'manifesto_invalido',
  caminho: [],
  mensagem,
});

export interface OpcoesDoComando {
  readonly entrada: string;
  readonly manifesto: string;
  readonly saida: string;
  /** Artefato versionado de decisões editoriais da ADR-011. */
  readonly decisoes?: string | undefined;
  /** Injetável para teste; por padrão grava mesmo. */
  readonly escrever?: (caminho: string, conteudo: string) => void;
}

/**
 * Escrita atômica: grava em temporário no mesmo diretório e renomeia. O rename
 * dentro do mesmo filesystem é atômico, então nunca existe um arquivo final
 * parcialmente escrito — o invariante "falha intermediária não deixa um
 * Markdown apresentado como válido" depende disso.
 */
export const escreverAtomicamente = (caminho: string, conteudo: string): void => {
  const alvo = resolve(caminho);
  const temporario = `${alvo}.${String(process.pid)}.tmp`;

  try {
    writeFileSync(temporario, conteudo, { encoding: 'utf8' });
    renameSync(temporario, alvo);
  } catch (erro) {
    rmSync(temporario, { force: true });
    throw erro;
  }
};

export const executarProcess = (opcoes: OpcoesDoComando): ResultadoDoComando => {
  let conteudo: string;
  let manifesto: Manifesto;
  let decisoes: readonly DecisaoEditorial[] = [];

  try {
    conteudo = readFileSync(resolve(opcoes.entrada), 'utf8');
  } catch {
    return {
      codigo: CODIGO_DE_SAIDA.entrada,
      relatorio: {
        ok: false,
        etapaFinal: 'entrada',
        problemas: [problemaDeEntrada(`Não foi possível ler a entrada: ${opcoes.entrada}`)],
      },
    };
  }

  try {
    manifesto = JSON.parse(readFileSync(resolve(opcoes.manifesto), 'utf8')) as Manifesto;
  } catch {
    return {
      codigo: CODIGO_DE_SAIDA.entrada,
      relatorio: {
        ok: false,
        etapaFinal: 'entrada',
        problemas: [
          problemaDeEntrada(`Manifesto ausente ou não é JSON válido: ${opcoes.manifesto}`),
        ],
      },
    };
  }

  if (opcoes.decisoes !== undefined) {
    try {
      const lidas: unknown = JSON.parse(readFileSync(resolve(opcoes.decisoes), 'utf8'));
      if (!Array.isArray(lidas)) throw new Error('esperado array JSON');
      decisoes = lidas as DecisaoEditorial[];
    } catch {
      return {
        codigo: CODIGO_DE_SAIDA.entrada,
        relatorio: {
          ok: false,
          etapaFinal: 'entrada',
          problemas: [
            problemaDeEntrada(`Decisões editoriais ausentes ou inválidas: ${opcoes.decisoes}`),
          ],
        },
      };
    }
  }

  const hashDoArtefato = sha256(conteudo);

  const snapshot: SourceSnapshot = {
    sha256: hashDoArtefato,
    conteudo,
    referencia: {
      sourceType: manifesto.sourceType,
      sourceRole: manifesto.sourceRole,
      sourceVariant: manifesto.sourceVariant,
      sourceUrl: manifesto.fonte,
      sourceArtifactSha256: hashDoArtefato,
      fragmentSha256: hashDoArtefato,
    },
  };

  const conjunto = montarConjuntoDeFontes([snapshot]);

  if (!conjunto.ok) {
    return {
      codigo: CODIGO_DE_SAIDA.entrada,
      relatorio: {
        ok: false,
        etapaFinal: 'entrada',
        problemas: conjunto.problemas.map((problema) => ({
          ...problema,
          etapa: 'entrada' as const,
        })),
      },
    };
  }

  const resultado = processar({
    conteudo,
    referenciaBase: conjunto.valor.primaria.referencia,
    hashDaLinha: sha256,
    metadados: manifesto,
    decisoesEditoriais: decisoes,
  });

  if (!resultado.relatorio.ok || resultado.markdown === undefined) {
    const etapa = resultado.relatorio.etapaFinal;

    return { codigo: CODIGO_DE_SAIDA[etapa], relatorio: resultado.relatorio };
  }

  try {
    const escrever = opcoes.escrever ?? escreverAtomicamente;

    escrever(resolve(opcoes.saida), resultado.markdown);
  } catch (erro) {
    return {
      codigo: CODIGO_DE_SAIDA.escrita,
      relatorio: {
        ok: false,
        etapaFinal: 'escrita',
        problemas: [
          {
            etapa: 'escrita',
            codigo: 'manifesto_invalido',
            caminho: [],
            mensagem: `Falha ao gravar em ${dirname(resolve(opcoes.saida))}: ${erro instanceof Error ? erro.message : String(erro)}`,
          },
        ],
      },
    };
  }

  return {
    codigo: CODIGO_DE_SAIDA.ok,
    relatorio: resultado.relatorio,
    markdown: resultado.markdown,
  };
};
