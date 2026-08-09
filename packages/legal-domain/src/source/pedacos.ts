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
  /**
   * A maior parte do conteúdo saiu dentro de `<b>`/`<strong>`.
   *
   * Maioria, e não totalidade, porque o Planalto deixa pedaços de fora sem
   * critério: ora um `;` depois do fechamento, ora o próprio designador.
   *
   * ```html
   * I -                                  <!-- fora -->
   * <strike>impostos sobre:</strike>     <!-- dentro -->
   * ```
   *
   * Exigir totalidade fazia um único caractere solto desqualificar a linha
   * inteira, e os dispositivos históricos do art. 155 e do art. 201 da CF/88
   * viravam órfãos.
   */
  readonly todoEmNegrito: boolean;
  /** A maior parte do conteúdo saiu dentro de `<strike>`/`<s>`/`<del>`. */
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
  // Zerado a cada pedaço, em `fechar()`. Deixá-lo atravessar a quebra de bloco
  // parece razoável — a nota às vezes abre num `<p>` e fecha noutro — mas basta
  // um `(` sem fechamento no HTML para a profundidade nunca mais voltar a zero,
  // e daí em diante todo pedaço conta zero caractere visível e perde a ênfase.
  // Foi o que aconteceu com sete redações riscadas do art. 100 da CF/88.
  let parenteses = 0;
  let visiveis = 0;
  let emNegrito = 0;
  let emRiscado = 0;

  const fechar = (): void => {
    const conteudo = texto.replace(/\s+/gu, ' ').trim();

    if (conteudo.length > 0) {
      pedacos.push({
        texto: conteudo,
        todoEmNegrito: visiveis > 0 && emNegrito * 2 > visiveis,
        todoRiscado: visiveis > 0 && emRiscado * 2 > visiveis,
      });
    }

    texto = '';
    parenteses = 0;
    visiveis = 0;
    emNegrito = 0;
    emRiscado = 0;
  };

  const emitir = (bruto: string): void => {
    const conteudo = decodificar(bruto);

    texto += conteudo;

    // Só letra e dígito contam. Pontuação e espaço soltos fora da tag são
    // resíduo de tipografia, não conteúdo — e o Planalto os deixa fora o tempo
    // todo:
    //
    //   <strike>II - ajuda à manutenção dos dependentes...</strike>
    //   ;
    //
    // Contar aquele `;` fazia a linha inteira deixar de ser riscada por causa
    // de um caractere, e os incisos históricos do art. 201 viravam órfãos.
    //
    // O que está entre parênteses também não conta, e por motivo mais forte: a
    // nota legislativa não é conteúdo do dispositivo, é procedência dele, e
    // vem sempre fora da ênfase.
    //
    // ```html
    // <b>Feminicídio</b><a href="...">(Incluído pela Lei nº 13.104, de 2015)</a>
    // ```
    //
    // São 11 caracteres em negrito contra 30 da nota. Pela maioria bruta a
    // rubrica deixava de ser rubrica, escapava do descarte e — por não ter
    // designador — era colada pela `juntarContinuacoes` no fim da pena do
    // art. 121: `Pena - reclusão, de doze a trinta anos. Feminicídio`.
    //
    // A exclusão vale para numerador e denominador ao mesmo tempo, então um
    // parêntese legítimo do texto ("menor de 14 (quatorze) anos") não desloca
    // a proporção para lado nenhum.
    let contagem = 0;

    for (const caractere of conteudo) {
      if (caractere === '(') {
        parenteses += 1;
        continue;
      }

      if (caractere === ')') {
        parenteses = Math.max(0, parenteses - 1);
        continue;
      }

      if (parenteses === 0 && /[\p{L}\p{N}]/u.test(caractere)) {
        contagem += 1;
      }
    }

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
