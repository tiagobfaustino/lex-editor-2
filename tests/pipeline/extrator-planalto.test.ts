// Extração do HTML do Planalto (Feature 004, T004-08).
//
// O caso central é o negrito, que o Planalto usa para **duas coisas opostas**:
// ementa de divisão, obrigatória, e rubrica (nomen juris), descartável. Três
// tentativas de regra sem contexto falharam — duas derrubando artigo, uma
// engolindo um artigo dentro do título. Estes testes prendem as duas leituras
// lado a lado, que é o que impede a quarta regressão.

import { describe, expect, it } from 'vitest';

import { extrairLinhas, reconhecer, varrerPedacos } from '@lex-editor/legal-domain';

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
});
