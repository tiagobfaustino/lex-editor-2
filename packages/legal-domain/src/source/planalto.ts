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

/** Marcação puramente visual que o Word deixa no HTML publicado. */
const TAGS_DESCARTAVEIS = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu;

/** Elementos que quebram linha no texto renderizado. */
const QUEBRAS = /<\/?(br|p|div|tr|h[1-6]|li)\b[^>]*>/giu;

const ENTIDADES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&ordm;': 'º',
  '&deg;': '°',
  '&sect;': '§',
};

const decodificar = (texto: string): string =>
  texto
    .replace(/&#(\d+);/gu, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/&[a-z]+;|&#\d+;/giu, (entidade) => ENTIDADES[entidade.toLowerCase()] ?? entidade);

/**
 * Notas de vigência e links de alteração que o Planalto intercala no texto.
 * São referência de navegação da página, não texto normativo — mas a nota
 * entre parênteses **é** significativa e fica: é ela que o parser lê para
 * decidir `deviceStatus`.
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

export interface OpcoesDeExtracao {
  /** Descarta tudo antes da primeira linha que casar. Útil para pular o preâmbulo. */
  readonly comecarEm?: RegExp;
  /** Descarta tudo a partir da primeira linha que casar. */
  readonly pararEm?: RegExp;
}

/**
 * Converte o HTML de uma página do Planalto em linhas de texto.
 *
 * O que sai daqui ainda não é NormaAST: é o texto plano de que o parser
 * precisa, com uma linha por dispositivo e sem marcação.
 */
export const extrairLinhas = (html: string, opcoes: OpcoesDeExtracao = {}): readonly string[] => {
  const semScripts = html.replace(TAGS_DESCARTAVEIS, ' ');
  const comQuebras = semScripts.replace(QUEBRAS, '\n');
  const semTags = comQuebras.replace(/<[^>]+>/gu, '');

  let linhas = decodificar(semTags)
    .split('\n')
    .map((linha) => linha.replace(/\s+/gu, ' ').trim())
    .filter((linha) => linha.length > 0)
    .filter((linha) => !RUIDO_DE_PAGINA.some((padrao) => padrao.test(linha)));

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

  for (const linha of linhas) {
    const ultima = resultado.at(-1);

    if (ultima !== undefined && !ehDesignador(linha)) {
      resultado[resultado.length - 1] = `${ultima} ${linha}`;
      continue;
    }

    resultado.push(linha);
  }

  return resultado;
};
