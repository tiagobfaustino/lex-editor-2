import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const productionCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

// A CSP de produção acima é a normativa da ADR-007 e não é relaxada aqui.
// O desenvolvimento precisa de duas concessões, ambas ausentes do pacote:
// o Vite injeta o CSS por `<style>` inline para permitir HMR — sem
// 'unsafe-inline' a janela abre sem estilo algum —, e o cliente de HMR fala
// com o dev server por HTTP e WebSocket em loopback. No build o CSS vira
// arquivo próprio servido da mesma origem, então `style-src 'self'` basta.
const developmentCsp = productionCsp
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
  .replace("connect-src 'none'", "connect-src 'self' ws:");

const contentSecurityPolicyPlugin = (): Plugin => ({
  name: 'lex-editor-content-security-policy',
  transformIndexHtml: {
    order: 'pre',
    handler(html, context) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: context.server ? developmentCsp : productionCsp,
            },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  },
});

export default defineConfig({
  main: {},
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name]-[hash].cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [contentSecurityPolicyPlugin()],
    build: {
      assetsInlineLimit: 0,
    },
  },
});
