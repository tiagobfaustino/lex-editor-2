// Extração do HTML do Planalto (Feature 004, T004-08).
//
// O caso central é o negrito, que o Planalto usa para **duas coisas opostas**:
// ementa de divisão, obrigatória, e rubrica (nomen juris), descartável. Três
// tentativas de regra sem contexto falharam — duas derrubando artigo, uma
// engolindo um artigo dentro do título. Estes testes prendem as duas leituras
// lado a lado, que é o que impede a quarta regressão.

import { describe, expect, it } from 'vitest';

import {
  extrairLinhas,
  juntarContinuacoes,
  reconhecer,
  varrerPedacos,
} from '@lex-editor/legal-domain';

const gramatica = (linha: string) => reconhecer(linha.replace(/^~~|~~$/gu, '').trim());

const extrair = (html: string): readonly string[] => extrairLinhas(html, { reconhecer: gramatica });

describe('os dois usos do negrito', () => {
  it('mantém a ementa da divisão, que vem em negrito logo após o designador', () => {
    const linhas = extrair(
      '<p>TÍTULO III<br><b>DA IMPUTABILIDADE PENAL</b><br>Art. 26 - É isento de pena.</p>',
    );

    expect(linhas).toContain('DA IMPUTABILIDADE PENAL');
    expect(linhas).toContain('Art. 26 - É isento de pena.');
  });

  it('descarta a rubrica, que vem em negrito após um dispositivo completo', () => {
    const linhas = extrair(
      '<p>Art. 187. Texto do artigo.<br><b>Falsa atribuição de privilégio</b><br>Art. 188. Outro artigo.</p>',
    );

    expect(linhas).not.toContain('Falsa atribuição de privilégio');
    expect(linhas).toContain('Art. 188. Outro artigo.');
  });

  it('nunca descarta um dispositivo, mesmo grafado em negrito', () => {
    const linhas = extrair('<p>Art. 1. Caput.<br><b>Art. 2. Também artigo.</b></p>');

    expect(linhas).toContain('Art. 2. Também artigo.');
  });

  it('o fechamento do negrito depois do <br> não condena o pedaço seguinte', () => {
    // É exatamente a forma do CP: `<b>rubrica <br></b> Art 188.` — a tag de
    // fechamento cai no pedaço do artigo. Foi o que derrubou artigo nas
    // tentativas que decidiam por marca embutida no texto.
    const linhas = extrair('<p><b>Rubrica qualquer <br></b> Art. 188. Texto.</p>');

    expect(linhas).not.toContain('Rubrica qualquer');
    expect(linhas.some((l) => l.startsWith('Art. 188.'))).toBe(true);
  });
});

describe('designadores concatenados pelo HTML do Word', () => {
  it('separa somente em fronteira editorial confirmada pela gramática', () => {
    const linhas = juntarContinuacoes(
      [
        'Art. 121-A. Conduta. (Incluído pela Lei nº 1) Pena – reclusão.',
        '§ 1º Hipóteses. (Incluído pela Lei nº 1) I – primeira; (Incluído pela Lei nº 1) II – segunda.',
      ],
      (linha) => gramatica(linha) !== undefined,
    );

    expect(linhas).toEqual([
      'Art. 121-A. Conduta. (Incluído pela Lei nº 1)',
      'Pena – reclusão.',
      '§ 1º Hipóteses. (Incluído pela Lei nº 1)',
      'I – primeira; (Incluído pela Lei nº 1)',
      'II – segunda.',
    ]);
  });

  it('não corta referência ou texto comum sem a fronteira editorial', () => {
    const linha = 'Art. 1. Aplica-se o art. 2 e a Pena - em sentido doutrinário.';
    expect(juntarContinuacoes([linha], (item) => gramatica(item) !== undefined)).toEqual([linha]);
  });
});

describe('rodapé institucional concatenado ao último artigo', () => {
  it('remove assinaturas somente quando a certificação oficial confirma o rodapé', () => {
    const linhas = extrair(
      '<p>Art. 250. Texto vigente. Brasília, 5 de outubro de 1988. Nome dos signatários. Este texto não substitui o publicado no D.O.U.</p>',
    );
    expect(linhas).toEqual(['Art. 250. Texto vigente.']);
  });

  it('ignora blocos de assinaturas até o próximo designador estrutural', () => {
    const linhas = extrair(
      '<p>Art. 250. Texto vigente.</p>' +
        '<p>Brasília, 5 de outubro de 1988.</p>' +
        '<p>Nome dos signatários.</p>' +
        '<p>Este texto não substitui o publicado no D.O.U.</p>' +
        '<p>ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS</p>' +
        '<p>Art. 1. Regra transitória.</p>',
    );
    expect(linhas).toEqual([
      'Art. 250. Texto vigente.',
      'ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS',
      'Art. 1. Regra transitória.',
    ]);
  });

  it('preserva Brasília quando faz parte do texto sem certificação de rodapé', () => {
    const linhas = extrair('<p>Art. 1. A sede fica em Brasília, 5 de outubro de 1988.</p>');
    expect(linhas).toEqual(['Art. 1. A sede fica em Brasília, 5 de outubro de 1988.']);
  });
});

describe('o varredor decide por pedaço, não por linha', () => {
  it('marca como todo em negrito só o pedaço realmente enfatizado', () => {
    const pedacos = varrerPedacos('<p><b>Rubrica <br></b>Art. 188. Texto.</p>');
    const rubrica = pedacos.find((p) => p.texto.startsWith('Rubrica'));
    const artigo = pedacos.find((p) => p.texto.startsWith('Art. 188'));

    expect(rubrica?.todoEmNegrito).toBe(true);
    expect(artigo?.todoEmNegrito).toBe(false);
  });

  it('espaço não desqualifica um pedaço enfatizado', () => {
    const [pedaco] = varrerPedacos('<p>  <b>  Rubrica  </b>  </p>');

    expect(pedaco?.todoEmNegrito).toBe(true);
  });

  it('reconhece o riscado como atributo, não como marca no texto', () => {
    const [pedaco] = varrerPedacos('<p><strike>Art. 51 - Texto revogado.</strike></p>');

    expect(pedaco?.todoRiscado).toBe(true);
    expect(pedaco?.texto).not.toContain('~~');
  });
});

describe('regras estruturais do HTML', () => {
  it('quebra crua do arquivo é espaço, não fim de parágrafo', () => {
    // O Planalto chega a separar "Art." de "20." com uma quebra de linha
    // literal dentro do mesmo elemento.
    const linhas = extrair('<p>Art. \r\n\t20. Nas esferas administrativa.</p>');

    expect(linhas).toEqual(['Art. 20. Nas esferas administrativa.']);
  });

  it('descarta ruído de navegação, mas preserva a nota entre parênteses', () => {
    const linhas = extrair(
      '<p>Vigência</p><p>Art. 1. Texto. (Revogado pela Lei nº 9.999, de 2027)</p>',
    );

    expect(linhas).not.toContain('Vigência');
    expect(linhas[0]).toContain('(Revogado pela Lei nº 9.999, de 2027)');
  });

  it('o riscado vira ~~ só na saída, depois de cumprir o papel de atributo', () => {
    const linhas = extrair('<p><strike>Art. 51 - Revogado.</strike></p>');

    expect(linhas[0]).toBe('~~Art. 51 - Revogado.~~');
  });

  it('a nota não conta na ênfase, então a rubrica curta continua rubrica', () => {
    // `Feminicídio` tem 11 caracteres em negrito contra 30 da nota, que vem
    // fora do `<b>`. Contando a nota, a rubrica perdia a maioria, escapava do
    // descarte e era colada no fim da pena do art. 121.
    const linhas = extrair(
      '<p>Pena - reclusão, de doze a trinta anos.</p>' +
        '<p><b>Feminicídio </b><a href="#">(Incluído pela Lei nº 13.104, de 2015)</a></p>',
    );

    expect(linhas).toEqual(['Pena - reclusão, de doze a trinta anos.']);
  });

  it('parentético desconhecido continua contando como conteúdo', () => {
    // O extrator só conhece notas editoriais com prefixo explícito. Tratar
    // qualquer parêntese como nota apagaria conteúdo que deve chegar intacto
    // ao parser.
    const linhas = extrair('<p><b>Observação</b> (conteúdo normativo sem nota oficial)</p>');

    expect(linhas).toEqual(['Observação (conteúdo normativo sem nota oficial)']);
  });

  it('parêntese sem fechamento não contamina o pedaço seguinte', () => {
    // A decisão é feita sobre notas completas encontradas no próprio pedaço.
    // Um `(` órfão não cria estado que atravesse a quebra e contamine o resto
    // do documento.
    const linhas = extrair(
      '<p>Art. 1. Texto com parêntese aberto (e nunca fechado</p>' +
        '<p><strike>Art. 2. Revogado.</strike></p>',
    );

    expect(linhas[1]).toBe('~~Art. 2. Revogado.~~');
  });
});
