import { describe, expect, it } from 'vitest';

import { defuddleSnapshot } from '../../src/main/import/defuddle.js';

describe('Defuddle no processo principal', () => {
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
