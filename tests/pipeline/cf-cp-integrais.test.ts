// Auditoria integral das duas normas de alto risco da Feature 004 (T004-08).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  decodificarHtmlPlanalto,
  extrairLinhas,
  juntarContinuacoes,
  reconhecer,
} from '@lex-editor/legal-domain';
import { CODIGO_DE_SAIDA, executarProcess } from '@lex-editor/cli/processar-arquivo.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/legal/', import.meta.url));

const projetarSnapshot = (nome: 'cf1988' | 'cp' | 'lindb'): string => {
  const bytes = readFileSync(`${FIXTURES}${nome}/snapshot.html`);
  const html = decodificarHtmlPlanalto(bytes);
  const gramatica = (linha: string) => reconhecer(linha.replace(/^~~|~~$/gu, '').trim());
  const linhas = juntarContinuacoes(
    extrairLinhas(html, {
      comecarEm: /^~?~?Art\.?\s*1[.º°o]/u,
      reconhecer: gramatica,
    }),
    (linha) => gramatica(linha) !== undefined,
  );
  return `${linhas.join('\n')}\n`;
};

describe('snapshots oficiais versionados', () => {
  it.each(['lindb', 'cp', 'cf1988'] as const)('%s reproduz entrada.txt byte a byte', (nome) => {
    expect(projetarSnapshot(nome)).toBe(readFileSync(`${FIXTURES}${nome}/entrada.txt`, 'utf8'));
  });
});

const rodar = (nome: 'cf1988' | 'cp') =>
  executarProcess({
    entrada: `${FIXTURES}${nome}/entrada.txt`,
    manifesto: `${FIXTURES}${nome}/manifesto.json`,
    saida: '/dev/null',
    ...(nome === 'cp' ? { decisoes: `${FIXTURES}cp/decisoes-editoriais.json` } : {}),
    escrever: () => undefined,
  });

describe('Constituição Federal integral', () => {
  it('atravessa o pipeline e separa corpo permanente do ADCT', () => {
    const resultado = rodar('cf1988');
    expect(resultado.codigo).toBe(CODIGO_DE_SAIDA.ok);
    expect(resultado.markdown).toContain('^cf1988-art-1');
    expect(resultado.markdown).toContain('^cf1988-adct-art-1');
    expect(resultado.markdown).toContain('^cf1988-adct-art-119');
    if (!resultado.relatorio.ok) return;
    expect(resultado.relatorio.metricas.artigos).toBe(411);
    expect(resultado.relatorio.metricas.nosExigindoRevisaoHumana).toBe(0);
  });

  it('preserva redações anteriores sem fabricar notas', () => {
    const resultado = rodar('cf1988');
    expect(resultado.markdown).toMatch(/- ~~Art\.[^\n]+~~\n/u);
  });
});

describe('Código Penal integral', () => {
  it('atravessa o pipeline com as decisões editoriais versionadas', () => {
    const resultado = rodar('cp');
    expect(resultado.codigo).toBe(CODIGO_DE_SAIDA.ok);
    if (!resultado.relatorio.ok) return;
    expect(resultado.relatorio.metricas.artigos).toBe(434);
    expect(resultado.relatorio.metricas.nosExigindoRevisaoHumana).toBe(0);
  });

  it('materializa dispositivos antes concatenados e sufixos compostos', () => {
    const resultado = rodar('cp');
    expect(resultado.markdown).toContain('^cp-art-121-a-pena');
    expect(resultado.markdown).toContain('^cp-art-121-a-par-1-inc-i');
    expect(resultado.markdown).toContain('^cp-art-359-m-a');
    expect(resultado.markdown).toContain('^cp-art-359-m-b');
  });

  it('o artefato contém uma decisão para cada ambiguidade auditada', () => {
    const decisoes = JSON.parse(
      readFileSync(`${FIXTURES}cp/decisoes-editoriais.json`, 'utf8'),
    ) as unknown[];
    expect(decisoes).toHaveLength(84);
  });
});
