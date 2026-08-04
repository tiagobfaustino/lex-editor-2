import { defineConfig } from '@playwright/test';

// O smoke roda contra o bundle de `out/`, equivalente ao pacote de produção,
// e não contra o servidor de desenvolvimento do Vite. Um teste que só abrisse
// a página isolada não exercitaria preload, IPC nem as preferências efetivas
// da janela, que são o risco real desta fundação.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // O Electron abre uma janela real: manter execução serial evita disputa por
  // display e torna a falha reproduzível.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
