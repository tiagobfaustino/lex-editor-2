import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

const sourceExtensions = '**/*.{js,mjs,cjs,ts,tsx}';
const typescriptExtensions = '**/*.{ts,tsx}';

const nodeImportNames = [
  ...new Set(
    builtinModules.flatMap((name) => {
      const bareName = name.replace(/^node:/u, '');
      return [bareName, `node:${bareName}`];
    }),
  ),
];

const restrictedPath = (name, message) => ({ name, message });
const nodePaths = nodeImportNames.map((name) =>
  restrictedPath(name, 'Esta camada não pode importar APIs do Node.js.'),
);

const boundaryRule = ({ paths = [], patterns = [] }) => [
  'error',
  {
    paths,
    patterns: patterns.map(({ group, message }) => ({
      group,
      message,
    })),
  },
];

const layerPatterns = (...layers) =>
  layers.flatMap((layer) => [
    `**/${layer}`,
    `**/${layer}/**`,
    `@lex-editor/${layer}`,
    `@lex-editor/${layer}/**`,
  ]);

export default defineConfig([
  globalIgnores([
    '.agents/**',
    '.playwright-mcp/**',
    'node_modules/**',
    '**/dist/**',
    'out/**',
    'build/**',
    'release/**',
    'artifacts/**',
    'coverage/**',
    'supabase/functions/publisher/generated/**',
    'supabase/functions/publisher/index.ts',
  ]),
  {
    files: [sourceExtensions],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [typescriptExtensions],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/legal-domain/src/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          ...nodePaths,
          restrictedPath('electron', 'O domínio não pode depender de Electron.'),
          restrictedPath('react', 'O domínio não pode depender de React.'),
          restrictedPath('react-dom', 'O domínio não pode depender de React DOM.'),
          restrictedPath('@supabase/supabase-js', 'O domínio não pode acessar banco ou rede.'),
        ],
        patterns: [
          {
            group: ['electron/**', 'react/**', 'react-dom/**', '@supabase/**'],
            message: 'O domínio aceita somente dependências puras e explicitamente aprovadas.',
          },
          {
            group: ['**/src', '**/src/**'],
            message: 'O pacote de domínio não pode atravessar para as camadas da aplicação.',
          },
        ],
      }),
    },
  },
  {
    files: ['packages/source-ingestion/src/*.{js,ts}'],
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          ...nodePaths,
          restrictedPath('electron', 'Os contratos de ingestão não podem depender de Electron.'),
          restrictedPath('react', 'Os contratos de ingestão não podem depender de React.'),
          restrictedPath('react-dom', 'Os contratos de ingestão não podem depender de React DOM.'),
          restrictedPath(
            '@supabase/supabase-js',
            'Os contratos de ingestão não podem acessar banco ou rede.',
          ),
        ],
        patterns: [
          {
            group: [
              'electron/**',
              'react/**',
              'react-dom/**',
              '@supabase/**',
              ...layerPatterns('main', 'preload', 'renderer'),
              '**/services',
              '**/services/**',
            ],
            message: 'O pacote de ingestão aceita somente dependências puras aprovadas.',
          },
        ],
      }),
    },
  },
  {
    files: ['packages/source-ingestion/src/node/**/*.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          restrictedPath(
            'electron',
            'A ingestão Node compartilhada não pode depender de Electron.',
          ),
          restrictedPath('react', 'A ingestão Node compartilhada não pode depender de React.'),
          restrictedPath(
            'react-dom',
            'A ingestão Node compartilhada não pode depender de React DOM.',
          ),
        ],
        patterns: [
          {
            group: [
              'electron/**',
              'react/**',
              'react-dom/**',
              ...layerPatterns('main', 'preload', 'renderer'),
              '**/services',
              '**/services/**',
            ],
            message: 'A implementação Node compartilhada não atravessa camadas consumidoras.',
          },
        ],
      }),
    },
  },
  {
    files: ['src/shared/ipc/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          ...nodePaths,
          restrictedPath(
            'electron',
            'Contratos IPC compartilhados não podem depender de Electron.',
          ),
          restrictedPath(
            '@lex-editor/legal-domain',
            'IPC deve projetar DTOs seguros, não reutilizar o domínio integral.',
          ),
        ],
        patterns: [
          {
            group: ['@lex-editor/legal-domain/**', ...layerPatterns('main', 'preload', 'renderer')],
            message: 'shared/ipc não pode depender de uma camada privilegiada ou de apresentação.',
          },
        ],
      }),
    },
  },
  {
    files: ['src/shared/publication/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          ...nodePaths,
          restrictedPath('electron', 'O protocolo compartilhado não pode depender de Electron.'),
        ],
        patterns: [
          {
            group: ['electron/**', ...layerPatterns('main', 'preload', 'renderer')],
            message: 'O protocolo compartilhado não pode atravessar uma camada da aplicação.',
          },
        ],
      }),
    },
  },
  {
    files: ['services/publisher/src/**/*.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          restrictedPath('electron', 'O publicador server-side não pode depender de Electron.'),
          restrictedPath('react', 'O publicador server-side não pode depender da apresentação.'),
          restrictedPath(
            'react-dom',
            'O publicador server-side não pode depender da apresentação.',
          ),
        ],
        patterns: [
          {
            group: [
              'electron/**',
              'react/**',
              'react-dom/**',
              ...layerPatterns('main', 'preload', 'renderer'),
            ],
            message: 'A autoridade server-side não pode importar camadas do aplicativo desktop.',
          },
        ],
      }),
    },
  },
  {
    files: ['services/source-catalog/src/**/*.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          restrictedPath('electron', 'O catálogo server-side não pode depender de Electron.'),
          restrictedPath('react', 'O catálogo server-side não pode depender da apresentação.'),
          restrictedPath('react-dom', 'O catálogo server-side não pode depender da apresentação.'),
        ],
        patterns: [
          {
            group: [
              'electron/**',
              'react/**',
              'react-dom/**',
              ...layerPatterns('main', 'preload', 'renderer'),
            ],
            message: 'A autoridade do catálogo não pode importar camadas do aplicativo desktop.',
          },
        ],
      }),
    },
  },
  {
    files: ['src/main/**/*.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-imports': boundaryRule({
        patterns: [
          {
            group: layerPatterns('preload', 'renderer'),
            message: 'O main não pode importar preload ou renderer.',
          },
        ],
      }),
    },
  },
  {
    files: ['src/preload/**/*.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          restrictedPath('@lex-editor/legal-domain', 'O preload expõe somente DTOs de shared/ipc.'),
        ],
        patterns: [
          {
            group: ['@lex-editor/legal-domain/**', ...layerPatterns('main', 'renderer')],
            message: 'O preload não pode importar domínio, main ou renderer.',
          },
        ],
      }),
    },
  },
  {
    files: ['src/renderer/**/*.{js,jsx,ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite()],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-imports': boundaryRule({
        paths: [
          ...nodePaths,
          restrictedPath('electron', 'O renderer não pode importar Electron.'),
          restrictedPath(
            '@lex-editor/legal-domain',
            'O renderer consome somente projeções DTO de shared/ipc.',
          ),
        ],
        patterns: [
          {
            group: [
              'electron/**',
              '@lex-editor/legal-domain/**',
              ...layerPatterns('main', 'preload'),
            ],
            message: 'O renderer não pode atravessar uma fronteira privilegiada.',
          },
        ],
      }),
    },
  },
]);
