// Projeção AST ↔ Postgres (Feature 004, T004-09).
//
// O critério de aceite é "round-trip não perde semântica". Um campo esquecido
// na projeção não quebra nada na hora: some na publicação e só aparece quando
// alguém procurar o histórico de um dispositivo e não achar. Por isso o teste
// principal compara a árvore inteira, não uma amostra de campos.

import { describe, expect, it } from 'vitest';

import {
  identifiedCompleta,
  type IdentifiedNormaAST,
  projetar,
  reconstruir,
} from '@lex-editor/legal-domain';

const ida = (arvore: IdentifiedNormaAST) => projetar(arvore);

describe('ida e volta sem perda semântica', () => {
  it('reconstrói a árvore rica exatamente', () => {
    const projecao = ida(identifiedCompleta);
    const volta = reconstruir(projecao);

    expect(volta.ok).toBe(true);
    expect(volta.ok ? volta.valor : undefined).toEqual(identifiedCompleta);
  });

  it('é ponto fixo: projetar a árvore reconstruída dá a mesma projeção', () => {
    const primeira = ida(identifiedCompleta);
    const volta = reconstruir(primeira);

    if (!volta.ok) {
      throw new Error('Esperava reconstrução.');
    }

    expect(JSON.stringify(projetar(volta.valor))).toBe(JSON.stringify(primeira));
  });

  it('preserva o histórico de redações da ADR-006', () => {
    const projecao = ida(identifiedCompleta);
    const comHistorico = projecao.dispositivos.find((d) => d.redacoes_anteriores.length > 0);

    expect(comHistorico).toBeDefined();

    const volta = reconstruir(projecao);
    const json = JSON.stringify(volta.ok ? volta.valor : {});

    expect(json).toContain('Redação dada pela Lei nº 8.888');
  });

  it('preserva a decisão de revogação e a evidência complementar', () => {
    const projecao = ida(identifiedCompleta);
    const revogado = projecao.dispositivos.find((d) => d.device_status === 'revoked');

    expect(revogado?.preservar_texto_revogado).toBe(true);
    expect(projecao.dispositivos.some((d) => d.supporting_source_refs.length > 0)).toBe(true);
  });

  it('preserva a tabela em conteudo_estruturado', () => {
    const tabela = ida(identifiedCompleta).dispositivos.find((d) => d.tipo === 'tabela');

    expect(tabela?.conteudo_estruturado?.headers).toEqual(['Coluna A', 'Coluna B']);
    expect(tabela?.conteudo_estruturado?.rows).toHaveLength(2);
  });
});

describe('forma das linhas conforme o DATA_MODEL', () => {
  const projecao = ida(identifiedCompleta);

  it('usa snake_case na fronteira e camelCase na AST (ADR-005)', () => {
    const primeira = projecao.dispositivos[0];

    expect(primeira).toHaveProperty('device_status');
    expect(primeira).not.toHaveProperty('deviceStatus');
    expect(projecao.lei).toHaveProperty('legal_status');
    expect(projecao.versao).toHaveProperty('data_verificacao_integridade');
  });

  it('divisão pode ter block_id nulo; dispositivo referenciável, não', () => {
    // É o CHECK do DATA_MODEL: tipo de divisão OU block_id não nulo.
    for (const linha of projecao.dispositivos) {
      const ehDivisao = ['livro', 'titulo', 'capitulo', 'secao', 'subsecao'].includes(linha.tipo);

      expect(ehDivisao || linha.block_id !== null).toBe(true);
    }
  });

  it('revogado sempre traz a decisão, como o CHECK exige', () => {
    for (const linha of projecao.dispositivos) {
      if (linha.device_status === 'revoked') {
        expect(linha.preservar_texto_revogado).not.toBeNull();
      }
    }
  });

  it('tabela sempre traz conteudo_estruturado, como o CHECK exige', () => {
    for (const linha of projecao.dispositivos) {
      expect(linha.tipo !== 'tabela' || linha.conteudo_estruturado !== null).toBe(true);
    }
  });

  it('a hierarquia vira parent_id, com as raízes soltas', () => {
    const raizes = projecao.dispositivos.filter((d) => d.parent_id === null);

    expect(raizes.length).toBeGreaterThan(0);

    const ids = new Set(projecao.dispositivos.map((d) => d.id));

    for (const linha of projecao.dispositivos) {
      expect(linha.parent_id === null || ids.has(linha.parent_id)).toBe(true);
    }
  });
});

describe('a volta é defensiva', () => {
  it('recusa parent_id que não existe', () => {
    const projecao = ida(identifiedCompleta);
    const corrompida = {
      ...projecao,
      dispositivos: projecao.dispositivos.map((d, i) =>
        i === 1 ? { ...d, parent_id: 'inexistente' } : d,
      ),
    };

    expect(reconstruir(corrompida).ok).toBe(false);
  });

  it('recusa linhas que não reconstroem uma árvore válida', () => {
    const projecao = ida(identifiedCompleta);
    const semTexto = {
      ...projecao,
      dispositivos: projecao.dispositivos.map((d) =>
        d.tipo === 'artigo' ? { ...d, texto: null } : d,
      ),
    };

    expect(reconstruir(semTexto).ok).toBe(false);
  });

  it('respeita a ordem entre irmãos mesmo se as linhas vierem embaralhadas', () => {
    const projecao = ida(identifiedCompleta);
    const embaralhada = { ...projecao, dispositivos: [...projecao.dispositivos].reverse() };
    const volta = reconstruir(embaralhada);

    expect(volta.ok).toBe(true);
    expect(volta.ok ? volta.valor : undefined).toEqual(identifiedCompleta);
  });
});
