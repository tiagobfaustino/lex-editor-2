// Extração do HTML do Planalto (Feature 004, T004-07).
//
// Puro de propósito: recebe o HTML como string e devolve linhas de texto. Quem
// baixa e grava é a CLI ou um script — o domínio continua sem `node:fs`.
//
// Este módulo é adaptador de **fonte**, não reconhecedor de hierarquia. Ele não
// sabe o que é artigo ou inciso; só desfaz a marcação e devolve linhas limpas.
// A separação é exigência do `plan.md`, e tem uma razão prática: quando o
// Planalto mudar o leiaute, o conserto fica contido aqui e nenhuma regra
// jurídica precisa ser tocada.

import { varrerPedacos } from './pedacos.js';

/**
 * Notas de vigência e links de navegação que o Planalto intercala. São
 * referência da página, não texto normativo — mas a nota entre parênteses **é**
 * significativa e fica: é dela que o parser tira o `deviceStatus`.
 */
const RUIDO_DE_PAGINA = [
  /^Vigência$/iu,
  /^Produção de efeito$/iu,
  /^Regulamento$/iu,
  /^Mensagem de veto$/iu,
  /^Texto compilado$/iu,
  /^Vide .*/iu,
  /^\(Vide .*\)$/iu,
];

/**
 * O Word pode deixar o fecho institucional no mesmo `<p>` do último artigo.
 * Só removemos a cauda quando os dois sinais de rodapé aparecem juntos:
 * local/data de assinatura e a certificação de que o HTML não substitui o
 * D.O.U. Um simples uso da palavra "Brasília" no texto normativo não basta.
 */
const semRodapeDeAssinaturas = (texto: string): string => {
  const inicio = texto.search(/\s+Brasília,\s+\d{1,2}\s+de\s+\p{L}+/iu);

  return inicio >= 0 && texto.slice(inicio).includes('Este texto não substitui o publicado')
    ? texto.slice(0, inicio).trimEnd()
    : texto;
};

/** O que a gramática do parser responde sobre um pedaço. */
export interface Reconhecimento {
  readonly tituloPendente?: boolean | undefined;
}

export interface OpcoesDeExtracao {
  /**
   * A gramática do parser, injetada.
   *
   * O extrator precisa dela para uma decisão só, e não a implementa: saber se
   * o pedaço anterior era uma divisão **esperando ementa**. Sem isso não dá
   * para distinguir os dois usos do negrito no Planalto, que são opostos —
   * ver `extrairLinhas`.
   */
  readonly reconhecer?: (linha: string) => Reconhecimento | undefined;
  /** Descarta tudo antes da primeira linha que casar. */
  readonly comecarEm?: RegExp;
  /** Descarta tudo a partir da primeira linha que casar. */
  readonly pararEm?: RegExp;
}

/**
 * Converte o HTML de uma página do Planalto em linhas de texto.
 *
 * O ponto delicado é o negrito, porque o Planalto o usa para **duas coisas
 * opostas**:
 *
 * | Pedaço anterior | O pedaço em negrito é |
 * |---|---|
 * | divisão sem ementa na mesma linha | a ementa dela, obrigatória |
 * | dispositivo completo | rubrica (nomen juris), descartável |
 *
 * ```text
 * TÍTULO III
 * DA IMPUTABILIDADE PENAL      <- negrito, ementa do título
 * Art. 26 - É isento de pena...
 *
 * Art. 187. (Revogado...)
 * Falsa atribuição de privilégio   <- negrito, rubrica
 * Art. 188. ...
 * ```
 *
 * Descartar todo negrito faz o título engolir o artigo seguinte; manter tudo
 * faz a rubrica grudar na ementa da divisão. A decisão exige contexto, e é por
 * isso que a gramática entra por parâmetro.
 */
export const extrairLinhas = (html: string, opcoes: OpcoesDeExtracao = {}): readonly string[] => {
  const reconhecer = opcoes.reconhecer ?? ((): undefined => undefined);
  const mantidos: string[] = [];
  let anteriorEsperaEmenta = false;
  let emRodapeDeAssinaturas = false;

  for (const pedaco of varrerPedacos(html)) {
    const texto = semRodapeDeAssinaturas(pedaco.texto);
    const reconhecido = reconhecer(texto);

    if (/^Brasília,\s+\d{1,2}\s+de\s+\p{L}+/iu.test(texto)) {
      emRodapeDeAssinaturas = true;
      continue;
    }

    if (emRodapeDeAssinaturas && reconhecido === undefined) {
      continue;
    }

    emRodapeDeAssinaturas = false;

    if (pedaco.todoEmNegrito && reconhecido === undefined && !anteriorEsperaEmenta) {
      // Rubrica: negrito, não é dispositivo, e nada antes dela espera ementa.
      continue;
    }

    // O riscado é conteúdo (ADR-006, MARKDOWN_SPEC §5) e só agora vira `~~`,
    // depois de ter cumprido seu papel como atributo do pedaço.
    const linha = pedaco.todoRiscado ? `~~${texto}~~` : texto;

    if (RUIDO_DE_PAGINA.some((padrao) => padrao.test(linha))) {
      continue;
    }

    anteriorEsperaEmenta = reconhecido?.tituloPendente === true;
    mantidos.push(linha);
  }

  let linhas: readonly string[] = mantidos;

  if (opcoes.comecarEm !== undefined) {
    const inicio = linhas.findIndex((linha) => opcoes.comecarEm?.test(linha) === true);

    if (inicio >= 0) {
      linhas = linhas.slice(inicio);
    }
  }

  if (opcoes.pararEm !== undefined) {
    const fim = linhas.findIndex((linha) => opcoes.pararEm?.test(linha) === true);

    if (fim >= 0) {
      linhas = linhas.slice(0, fim);
    }
  }

  return linhas;
};

/**
 * Junta linhas que o HTML quebrou no meio de uma frase.
 *
 * O HTML exportado do Word quebra o parágrafo em vários nós, então o texto de
 * um único dispositivo chega picado. Uma linha que **não** começa com
 * designador é continuação da anterior — é a única forma segura de remontar,
 * porque juntar por comprimento ou por pontuação erraria em texto jurídico,
 * que é cheio de abreviação e de frase longa.
 */
export const juntarContinuacoes = (
  linhas: readonly string[],
  ehDesignador: (linha: string) => boolean,
): readonly string[] => {
  const resultado: string[] = [];
  const riscada = (linha: string): boolean => linha.startsWith('~~');

  /**
   * O Word às vezes põe dois dispositivos no mesmo bloco. Só separamos quando
   * o novo designador vem depois de uma nota editorial fechada — fronteira
   * verificável no próprio HTML achatado — e a gramática confirma todo o
   * sufixo. Isso evita cortes por palavras ou números incidentais.
   */
  const separarEmbutidos = (linha: string): string[] => {
    const separar = (restante: string): string[] => {
      const espacos = [...restante.matchAll(/\s+/gu)];
      const fronteira = espacos.find((espaco) => {
        const inicio = espaco.index;
        const prefixo = restante.slice(0, inicio).trimEnd();
        const sufixo = restante.slice(inicio + espaco[0].length).trimStart();

        return (prefixo.endsWith(')') || prefixo.endsWith('Vigência')) && ehDesignador(sufixo);
      });

      if (fronteira === undefined) {
        return [restante];
      }

      const inicio = fronteira.index;
      const prefixo = restante.slice(0, inicio).trimEnd();
      const sufixo = restante.slice(inicio + fronteira[0].length).trimStart();
      return [prefixo, ...separar(sufixo)];
    };

    return separar(linha);
  };

  for (const linha of linhas.flatMap(separarEmbutidos)) {
    const ultima = resultado.at(-1);

    // O riscado é fronteira: uma redação anterior não absorve a redação
    // vigente que a segue, nem o contrário. Sem isso, o art. 187 revogado do
    // CP engoliria o texto do 188, e as duas viriam como um dispositivo só —
    // com o texto de um sob o estado do outro.
    const mesmoEstado = ultima !== undefined && riscada(ultima) === riscada(linha);

    if (ultima !== undefined && mesmoEstado && !ehDesignador(linha)) {
      const continuacao = riscada(linha) ? linha.replace(/^~~|~~$/gu, '') : linha;
      const base = riscada(ultima) ? ultima.replace(/~~$/u, '') : ultima;

      resultado[resultado.length - 1] = riscada(ultima)
        ? `${base} ${continuacao}~~`
        : `${base} ${continuacao}`;
      continue;
    }

    resultado.push(linha);
  }

  return resultado;
};
