import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Os testes de domínio importam o pacote pelo nome público, para exercitar o
  // que `exports` realmente entrega. O alias aponta para a fonte em vez de
  // `dist/`, de modo que `npm test` não dependa de um build anterior nem possa
  // passar sobre um artefato velho. O contrato compilado é coberto por
  // `npm run typecheck`, que roda o tsc do próprio pacote.
  resolve: {
    alias: {
      '@lex-editor/source-ingestion/node': fileURLToPath(
        new URL('./packages/source-ingestion/src/node/index.ts', import.meta.url),
      ),
      '@lex-editor/legal-domain': fileURLToPath(
        new URL('./packages/legal-domain/src/index.ts', import.meta.url),
      ),
      '@lex-editor/source-ingestion': fileURLToPath(
        new URL('./packages/source-ingestion/src/index.ts', import.meta.url),
      ),
      '@lex-editor/cli/processar-arquivo.js': fileURLToPath(
        new URL('./packages/cli/src/processar-arquivo.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
