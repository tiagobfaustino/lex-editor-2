// Varredura do HTML em pedaços de bloco (Feature 004, T004-08).
//
// Existe porque decidir sobre a linha já achatada não funciona. O `<b>` do
// Planalto abre antes de um `<br>` e fecha depois dele, então uma marca posta
// dentro do texto sobrevive à quebra e cai no pedaço seguinte — o do artigo.
// Três tentativas de regra baseadas em marca no texto derrubaram artigo por
// causa disso.
//
// A saída é a ênfase virar **atributo do pedaço**, decidida enquanto se varre.
// O varredor mantém a profundidade de `<b>` e conta, por pedaço, quantos
// caracteres visíveis saíram dentro e fora dela. O pedaço do artigo tem zero
// caracteres em negrito, mesmo tendo recebido a tag de fechamento.

/** Marcação puramente visual que o Word deixa no HTML publicado. */
const TAGS_DESCARTAVEIS = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu;

const QUEBRA_DE_BLOCO = /^(br|p|div|tr|h[1-6]|li)$/iu;
const ENFASE_FORTE = /^(b|strong)$/iu;
const RISCADO = /^(strike|s|del)$/iu;

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

export interface Pedaco {
  /** Texto visível, com espaços colapsados. */
  readonly texto: string;
  /** Todo caractere visível saiu dentro de `<b>`/`<strong>`. */
  readonly todoEmNegrito: boolean;
  /** Todo caractere visível saiu dentro de `<strike>`/`<s>`/`<del>`. */
  readonly todoRiscado: boolean;
}

/**
 * Varre o HTML e devolve um pedaço por bloco, com a ênfase como atributo.
 *
 * Nenhum marcador é embutido no texto: é o embutimento que confunde, porque a
 * marca atravessa a quebra de bloco e o atributo não.
 */
export const varrerPedacos = (html: string): readonly Pedaco[] => {
  const limpo = html.replace(TAGS_DESCARTAVEIS, ' ');
  const pedacos: Pedaco[] = [];

  let negrito = 0;
  let riscado = 0;
  let texto = '';
  let visiveis = 0;
  let emNegrito = 0;
  let emRiscado = 0;

  const fechar = (): void => {
    const conteudo = texto.replace(/\s+/gu, ' ').trim();

    if (conteudo.length > 0) {
      pedacos.push({
        texto: conteudo,
        todoEmNegrito: visiveis > 0 && emNegrito === visiveis,
        todoRiscado: visiveis > 0 && emRiscado === visiveis,
      });
    }

    texto = '';
    visiveis = 0;
    emNegrito = 0;
    emRiscado = 0;
  };

  const emitir = (bruto: string): void => {
    const conteudo = decodificar(bruto);

    texto += conteudo;

    // Espaço não conta: uma rubrica seguida de espaço fora do `<b>` continua
    // inteiramente em negrito para efeito da decisão.
    const contagem = conteudo.replace(/\s/gu, '').length;

    visiveis += contagem;

    if (negrito > 0) {
      emNegrito += contagem;
    }

    if (riscado > 0) {
      emRiscado += contagem;
    }
  };

  const marcador = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)\b[^>]*>/gu;
  let posicao = 0;
  let achado: RegExpExecArray | null;

  while ((achado = marcador.exec(limpo)) !== null) {
    emitir(limpo.slice(posicao, achado.index));
    posicao = achado.index + achado[0].length;

    const nome = achado[1];

    if (nome === undefined) {
      continue;
    }

    const fechamento = achado[0].startsWith('</');

    if (QUEBRA_DE_BLOCO.test(nome)) {
      fechar();
      continue;
    }

    if (ENFASE_FORTE.test(nome)) {
      negrito = fechamento ? Math.max(0, negrito - 1) : negrito + 1;
      continue;
    }

    if (RISCADO.test(nome)) {
      riscado = fechamento ? Math.max(0, riscado - 1) : riscado + 1;
    }
  }

  emitir(limpo.slice(posicao));
  fechar();

  return pedacos;
};
