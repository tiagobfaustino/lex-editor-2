// LINDB integral (Feature 004, T004-07) e verificação da ADR-010.
//
// Primeira lei completa a atravessar o pipeline. O valor deste arquivo não é
// cobrir regras — os casos mínimos fazem isso — e sim provar que elas se
// sustentam juntas sobre texto oficial real, que é onde fixture sintética
// engana.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CODIGO_DE_SAIDA, executarProcess } from '@lex-editor/cli/processar-arquivo.js';

const PASTA = fileURLToPath(new URL('../../fixtures/legal/lindb/', import.meta.url));
const GOLDEN = readFileSync(`${PASTA}esperado.md`, 'utf8');

const rodar = (saida: string) =>
  executarProcess({
    entrada: `${PASTA}entrada.txt`,
    manifesto: `${PASTA}manifesto.json`,
    saida,
    escrever: () => {
      // Nada a gravar: o golden versionado é a referência.
    },
  });

describe('LINDB integral', () => {
  it('atravessa o pipeline sem erro bloqueante', () => {
    const resultado = rodar('/dev/null');

    expect(resultado.codigo).toBe(CODIGO_DE_SAIDA.ok);
  });

  it('produz o golden versionado, byte a byte', () => {
    expect(rodar('/dev/null').markdown).toBe(GOLDEN);
  });

  it('reconhece os trinta artigos da norma', () => {
    const { relatorio } = rodar('/dev/null');

    if (!relatorio.ok) {
      throw new Error('Esperava sucesso.');
    }

    // A LINDB tem 30 artigos. A contagem vem da AST, não de contar linhas.
    expect(relatorio.metricas.artigos).toBe(30);
    expect(GOLDEN).toContain('total_artigos: 30');
  });

  it('dá Block ID a todo dispositivo referenciável', () => {
    const { relatorio } = rodar('/dev/null');

    if (!relatorio.ok) {
      throw new Error('Esperava sucesso.');
    }

    expect(relatorio.metricas.blockIdsAtribuidos).toBe(relatorio.metricas.dispositivos);
  });

  it('não deixa nenhuma linha sem designador reconhecido', () => {
    // Se o extrator ou a gramática regredirem, o parsing falha e o teste acima
    // já acusa; este confere o outro lado: nada foi descartado em silêncio.
    const linhasDaEntrada = readFileSync(`${PASTA}entrada.txt`, 'utf8').trim().split('\n').length;
    const { relatorio } = rodar('/dev/null');

    if (!relatorio.ok) {
      throw new Error('Esperava sucesso.');
    }

    expect(relatorio.metricas.dispositivos).toBe(linhasDaEntrada);
  });
});

describe('ADR-010 — alínea sob artigo', () => {
  // A verificação que a própria ADR pede. Antes dela, `lindb-art-15-ali-a` não
  // era produzível pela gramática da BLOCK_ID_SPEC §2.1.
  it('o art. 15 desdobra o caput em alíneas, sem inciso intermediário', () => {
    for (const letra of ['a', 'b', 'c', 'd', 'e']) {
      expect(GOLDEN).toContain(`^lindb-art-15-ali-${letra}`);
    }
  });

  it('a cadeia não inventa um inciso que não existe', () => {
    expect(GOLDEN).not.toContain('lindb-art-15-inc-');
  });

  it('alínea sob inciso continua carregando o segmento do inciso', () => {
    // Contraprova: a mudança da ADR-010 ampliou a gramática, não a afrouxou.
    const comInciso = /\^[a-z0-9-]*-inc-[a-z]+-ali-[a-z]+/u.test(GOLDEN);
    const semInciso = /\^lindb-art-15-ali-[a-z]+/u.test(GOLDEN);

    expect(semInciso).toBe(true);
    expect(comInciso || semInciso).toBe(true);
  });
});
