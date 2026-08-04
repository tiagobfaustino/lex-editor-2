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

const developmentCsp = productionCsp.replace("connect-src 'none'", "connect-src 'self' ws:");

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
