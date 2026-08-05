// Pureza do pacote de domínio e cobertura do DATA_MODEL.
//
// O quarto critério de aceite da Feature 002 é "pacote não importa
// infraestrutura". O ESLint já barra isso na fronteira, mas a regra de lint
// pode ser afrouxada em um commit distraído sem que nada mais acuse. Este teste
// lê a fonte e decide sozinho — é a diferença entre uma convenção e uma
// garantia.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  identifiedCompleta,
  percorrer,
  TIPOS_DIVISAO,
  TIPOS_REFERENCIAVEIS,
  tipoNoSchema,
} from '@lex-editor/legal-domain';

const RAIZ_DO_DOMINIO = fileURLToPath(new URL('../../packages/legal-domain/src', import.meta.url));

const arquivosDoDominio = (diretorio: string): string[] =>
  readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name);

    if (entrada.isDirectory()) {
      return arquivosDoDominio(caminho);
    }

    return entrada.isFile() && entrada.name.endsWith('.ts') ? [caminho] : [];
  });

/** Captura o especificador de todo `import`/`export ... from` e `import(...)`. */
const especificadoresImportados = (fonte: string): string[] => {
  const encontrados: string[] = [];
  const padroes = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const padrao of padroes) {
    for (const casamento of fonte.matchAll(padrao)) {
      const especificador = casamento[1];

      if (especificador !== undefined) {
        encontrados.push(especificador);
      }
    }
  }

  return encontrados;
};

/** Única dependência externa aprovada: schemas de runtime. */
const DEPENDENCIAS_APROVADAS = new Set(['zod']);

describe('pureza do pacote de domínio', () => {
  const arquivos = arquivosDoDominio(RAIZ_DO_DOMINIO);

  it('tem fonte para inspecionar', () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it('não importa Electron, React, banco, rede nem filesystem', () => {
    const violacoes: string[] = [];

    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, 'utf8');

      for (const especificador of especificadoresImportados(fonte)) {
        // Import relativo é interno ao pacote.
        if (especificador.startsWith('.')) {
          continue;
        }

        // Builtin do Node, com ou sem o prefixo `node:`, é infraestrutura.
        const raizDoPacote = especificador.startsWith('@')
          ? especificador.split('/').slice(0, 2).join('/')
          : (especificador.split('/')[0] ?? especificador);

        if (!DEPENDENCIAS_APROVADAS.has(raizDoPacote)) {
          violacoes.push(`${arquivo.slice(RAIZ_DO_DOMINIO.length + 1)} → ${especificador}`);
        }
      }
    }

    expect(violacoes).toEqual([]);
  });

  it('declara zod como dependência própria, sem depender de hoisting', () => {
    const manifesto = JSON.parse(
      readFileSync(join(RAIZ_DO_DOMINIO, '..', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    expect(manifesto.dependencies?.['zod']).toBeDefined();
  });

  it('não usa um campo genérico `status` (ADR-005, RF-002-05)', () => {
    // A ADR-005 proíbe `status`, `situacao` e `estado` sem qualificador
    // semântico. Os nomes válidos são legalStatus, publicationStatus e
    // deviceStatus.
    const violacoes: string[] = [];

    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, 'utf8');

      for (const casamento of fonte.matchAll(/^\s*(status|situacao|estado)\s*:/gm)) {
        violacoes.push(`${arquivo.slice(RAIZ_DO_DOMINIO.length + 1)} → ${casamento[1] ?? ''}`);
      }
    }

    expect(violacoes).toEqual([]);
  });
});

describe('cobertura do DATA_MODEL', () => {
  const TIPOS_DO_DATA_MODEL = [
    'lei',
    'livro',
    'titulo',
    'capitulo',
    'secao',
    'subsecao',
    'artigo',
    'paragrafo',
    'inciso',
    'alinea',
    'item',
    'pena',
    'anexo',
    'tabela',
  ] as const;

  it('declara exatamente os catorze tipos de nó do modelo', () => {
    expect([...tipoNoSchema.options].sort()).toEqual([...TIPOS_DO_DATA_MODEL].sort());
  });

  it('classifica cada tipo como referenciável, divisão ou raiz', () => {
    const classificados = new Set([...TIPOS_REFERENCIAVEIS, ...TIPOS_DIVISAO, 'lei']);

    expect([...classificados].sort()).toEqual([...TIPOS_DO_DATA_MODEL].sort());
  });

  it('exercita cada tipo de nó na fixture completa', () => {
    // Se um tipo existir no schema mas nunca aparecer em fixture alguma, o
    // contrato dele nunca foi executado — só declarado.
    const vistos = new Set<string>();

    percorrer(
      identifiedCompleta,
      ({ no }) => {
        if (typeof no['tipo'] === 'string') {
          vistos.add(no['tipo']);
        }
      },
      () => {
        throw new Error('A fixture não deveria conter ciclo.');
      },
    );

    expect([...vistos].sort()).toEqual([...TIPOS_DO_DATA_MODEL].sort());
  });
});
