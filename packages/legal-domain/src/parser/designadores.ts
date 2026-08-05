// Gramática de designadores normativos (Feature 004, T004-02).
//
// Separada do percurso do parser porque é a tabela que cresce a cada norma
// nova, e é ela que a matriz de cobertura rastreia. Uma regra aqui é uma linha
// lá.
//
// Nada nesta tabela conhece o nome de uma lei. O `plan.md` proíbe exceção por
// nome quando a regra é estrutural — se o Código Penal precisa de um caso, é
// porque a estrutura o exige, e então vale para qualquer norma.

/** Divisões estruturais, da mais externa para a mais interna. */
export const DIVISOES = ['livro', 'titulo', 'capitulo', 'secao', 'subsecao'] as const;

export type TipoDivisao = (typeof DIVISOES)[number];

export type TipoDispositivo =
  'artigo' | 'paragrafo' | 'inciso' | 'alinea' | 'item' | 'pena' | 'anexo' | 'tabela';

export type TipoReconhecido = TipoDivisao | TipoDispositivo;

export interface Reconhecimento {
  readonly tipo: TipoReconhecido;
  /** Número/letra bruto, ainda sem normalizar para Block ID. */
  readonly numero: string;
  readonly texto: string;
  /** Divisão cujo título vem na linha seguinte, como no texto do Planalto. */
  readonly tituloPendente?: boolean;
}

interface Regra {
  readonly tipo: TipoReconhecido;
  readonly padrao: RegExp;
  readonly extrair: (m: RegExpMatchArray) => Omit<Reconhecimento, 'tipo'>;
}

/** Aceita `1º`, `1°`, `1o` e `1` — o texto oficial mistura os três primeiros. */
const ORDINAL = '[º°o]?';

const semTitulo = (numero: string, texto: string): Omit<Reconhecimento, 'tipo'> =>
  texto.trim().length > 0
    ? { numero, texto: texto.trim() }
    : { numero, texto: '', tituloPendente: true };

/**
 * As divisões aparecem de duas formas no texto oficial: `CAPÍTULO I` sozinho,
 * com a ementa na linha seguinte, ou `Capítulo I - Dos Crimes` na mesma linha.
 * As duas são suportadas; `tituloPendente` marca a primeira.
 */
const regraDeDivisao = (tipo: TipoDivisao, rotulo: string): Regra => ({
  tipo,
  padrao: new RegExp(`^${rotulo}\\s+([IVXLCDM]+|\\d+)\\s*(?:[-–—.]\\s*)?(.*)$`, 'iu'),
  extrair: (m) => semTitulo(m[1] ?? '', m[2] ?? ''),
});

/**
 * Ordem de teste, de cima para baixo. O primeiro padrão que casa vence, então
 * o mais específico vem antes: `Parágrafo único` antes de `§`, e as divisões
 * antes de qualquer coisa que possa começar com romano.
 */
export const REGRAS: readonly Regra[] = [
  regraDeDivisao('livro', 'LIVRO'),
  regraDeDivisao('titulo', 'T[ÍI]TULO'),
  regraDeDivisao('capitulo', 'CAP[ÍI]TULO'),
  regraDeDivisao('subsecao', 'SUBSE[ÇC][ÃA]O'),
  regraDeDivisao('secao', 'SE[ÇC][ÃA]O'),
  {
    // `ANEXO I` com título na linha seguinte, ou `Anexo I - Tabela Oficial`.
    // É dispositivo referenciável, não divisão: recebe Block ID `anx-{n}`.
    tipo: 'anexo',
    padrao: /^ANEXO\s+([IVXLCDM]+|\d+|[A-Za-z])\s*(?:[-–—.]\s*)?(.*)$/iu,
    extrair: (m) => semTitulo(m[1] ?? '', m[2] ?? ''),
  },
  {
    // Tabela simples suportada, na forma canônica da MARKDOWN_SPEC §3.3:
    // `Tabela 1. Legenda | Cab1; Cab2 | a1; b1 / a2; b2`
    tipo: 'tabela',
    padrao: /^Tabela\s+(\d+)\s*[.\-–—]?\s*([^|]*)\|(.*)$/iu,
    extrair: (m) => ({ numero: m[1] ?? '', texto: `${(m[2] ?? '').trim()}|${m[3] ?? ''}` }),
  },
  {
    // `Art. 121.` e `Art. 121-A.` — o sufixo alfabético é parte do número
    // (BLOCK_ID_SPEC §2.3.6), não um subdispositivo.
    tipo: 'artigo',
    padrao: new RegExp(
      `^Art\\.?\\s*(\\d+)\\s*${ORDINAL}\\s*(?:-\\s*([A-Za-z]+))?\\s*[.\\-–—]?\\s*(.*)$`,
      'u',
    ),
    extrair: (m) => ({
      numero: m[2] === undefined ? (m[1] ?? '') : `${m[1] ?? ''}-${m[2]}`,
      texto: (m[3] ?? '').trim(),
    }),
  },
  {
    tipo: 'pena',
    padrao: /^(Pena|Multa|Detenção|Reclusão)\s*[-–—:]\s*(.*)$/u,
    extrair: (m) => ({ numero: '', texto: `${m[1] ?? ''} - ${(m[2] ?? '').trim()}` }),
  },
  {
    tipo: 'paragrafo',
    padrao: /^Par[áa]grafo\s+[úu]nico\s*[.\-–—]?\s*(.*)$/iu,
    extrair: (m) => ({ numero: 'unico', texto: (m[1] ?? '').trim() }),
  },
  {
    tipo: 'paragrafo',
    padrao: new RegExp(
      `^§\\s*(\\d+)\\s*${ORDINAL}\\s*(?:-\\s*([A-Za-z]+))?\\s*[.\\-–—]?\\s*(.*)$`,
      'u',
    ),
    extrair: (m) => ({
      numero: m[2] === undefined ? (m[1] ?? '') : `${m[1] ?? ''}-${m[2]}`,
      texto: (m[3] ?? '').trim(),
    }),
  },
  {
    // Inciso em romano, com sufixo opcional (`VII-A`).
    tipo: 'inciso',
    padrao: /^([IVXLCDM]+(?:-[A-Za-z]+)?)\s*[-–—]\s*(.*)$/u,
    extrair: (m) => ({ numero: m[1] ?? '', texto: (m[2] ?? '').trim() }),
  },
  {
    // Alínea: letra única ou dupla (BLOCK_ID_SPEC §7.2).
    tipo: 'alinea',
    padrao: /^([a-z]{1,2})\)\s*(.*)$/u,
    extrair: (m) => ({ numero: m[1] ?? '', texto: (m[2] ?? '').trim() }),
  },
  {
    // Item: cardinal arábico seguido de ponto. Vem depois do artigo, que já
    // consumiu `Art. N.`, então não há ambiguidade.
    tipo: 'item',
    padrao: /^(\d+)\s*[.\-–—)]\s*(.*)$/u,
    extrair: (m) => ({ numero: m[1] ?? '', texto: (m[2] ?? '').trim() }),
  },
];

export const reconhecer = (linha: string): Reconhecimento | undefined => {
  for (const regra of REGRAS) {
    const casamento = regra.padrao.exec(linha);

    if (casamento !== null) {
      return { tipo: regra.tipo, ...regra.extrair(casamento) };
    }
  }

  return undefined;
};

/** Pais possíveis de cada dispositivo, do mais próximo ao mais distante. */
export const PAIS_POSSIVEIS: Readonly<Record<TipoDispositivo, readonly TipoDispositivo[]>> =
  Object.freeze({
    artigo: [],
    paragrafo: ['artigo'],
    inciso: ['paragrafo', 'artigo'],
    alinea: ['inciso'],
    item: ['alinea'],
    // A pena pode pender de qualquer dispositivo textual; qual deles é o certo
    // é decidido pela regra de ancoragem, não por esta lista.
    pena: ['item', 'alinea', 'inciso', 'paragrafo', 'artigo'],
    anexo: [],
    // Tabela pende do anexo quando há um aberto; solta, é nó de topo.
    tabela: ['anexo'],
  });

/** Nós que abrem um novo contexto de topo, como o artigo. */
export const ABREM_CONTEXTO: ReadonlySet<TipoDispositivo> = new Set(['artigo', 'anexo']);

export const ehDivisao = (tipo: TipoReconhecido): tipo is TipoDivisao =>
  (DIVISOES as readonly string[]).includes(tipo);

/** Profundidade da divisão: livro é 0, subseção é 4. */
export const nivelDaDivisao = (tipo: TipoDivisao): number => DIVISOES.indexOf(tipo);
