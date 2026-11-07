import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { defuddleSnapshot } from '../../src/main/import/defuddle.js';
import { decodificarHtmlPlanalto, extrairLinhas, reconhecer } from '@lex-editor/legal-domain';

describe('Defuddle no processo principal', () => {
  it('preserva artigos fora dos fechamentos prematuros de body/html do Planalto', async () => {
    const result = await defuddleSnapshot(
      '<html><head><title>DEL2848</title></head><body><p>Código Penal.</p></body></html>' +
        '<p><strike>Art. 1º Redação anterior.</strike></p>' +
        '<p>Art. 1º Não há crime sem lei anterior que o defina.</p>' +
        '<script>globalThis.__defuddleProbe="executado"</script>',
      'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848.htm',
    );

    expect(extrairLinhas(result.cleanedHtml, { reconhecer })).toEqual([
      'Código Penal.',
      '~~Art. 1º Redação anterior.~~',
      'Art. 1º Não há crime sem lei anterior que o defina.',
    ]);
    expect(result.cleanedMarkdown).toContain('Não há crime sem lei anterior que o defina.');
    expect(JSON.stringify(result)).not.toMatch(/<script|executado/iu);
  });

  it('mantém fronteiras de parágrafo e negrito usadas pela gramática jurídica', async () => {
    const result = await defuddleSnapshot(
      decodificarHtmlPlanalto(await readFile('fixtures/legal/cp/snapshot.html')),
      'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm',
    );

    const lines = extrairLinhas(result.cleanedHtml, { reconhecer });
    expect(lines).toContain('TÍTULO I');
    expect(lines).toContain('DA APLICAÇÃO DA LEI PENAL');
    expect(lines).toContain(
      'Art. 1º - Não há crime sem lei anterior que o defina. Não há pena sem prévia cominação legal. (Redação dada pela Lei nº 7.209, de 11.7.1984)',
    );
  });

  it('produz HTML e Markdown limpos sem executar ou preservar script', async () => {
    globalThis.__defuddleProbe = 'intacto';
    const result = await defuddleSnapshot(
      '<html><head><title>Lei teste</title></head><body><main><script>globalThis.__defuddleProbe="executado"</script><p>Art. 1º Conteúdo.</p></main></body></html>',
      'https://www.planalto.gov.br/lei.htm',
    );

    expect(globalThis.__defuddleProbe).toBe('intacto');
    expect(result.cleanedHtml).toContain('Art. 1º Conteúdo.');
    expect(result.cleanedMarkdown).toContain('Art. 1º Conteúdo.');
    expect(JSON.stringify(result)).not.toMatch(/<script|executado/iu);
    globalThis.__defuddleProbe = undefined;
  });
});

declare global {
  // Apenas uma sentinela do teste; não faz parte da aplicação.
  var __defuddleProbe: string | undefined;
}
