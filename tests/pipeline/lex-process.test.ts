// Pipeline vertical da Feature 003, da fixture ao Markdown canônico.
//
// A TEST_STRATEGY classifica parsing, hierarquia jurídica, Block IDs e
// Markdown canônico como "sempre automatizar". O determinismo tem teste
// próprio porque a RF-003-01 fala em bytes, não em equivalência: a Feature 007
// vai derivar o hash de publicação exatamente destes bytes.

import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { analisar, formatar, identificar, parsedMinima, processar } from '@lex-editor/legal-domain';

import { CODIGO_DE_SAIDA, executarProcess, sha256 } from '@lex-editor/cli/processar-arquivo.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/legal/cp-art-121/', import.meta.url));
const ENTRADA = join(FIXTURES, 'entrada.txt');
const MANIFESTO = join(FIXTURES, 'manifesto.json');
const GOLDEN = join(FIXTURES, 'esperado.md');
const ORFAO = join(FIXTURES, 'entrada-inciso-orfao.txt');

const temporario = mkdtempSync(join(tmpdir(), 'lex-pipeline-'));

afterAll(() => {
  rmSync(temporario, { recursive: true, force: true });
});

const rodar = (entrada: string, nomeDaSaida: string) =>
  executarProcess({
    entrada,
    manifesto: MANIFESTO,
    saida: join(temporario, nomeDaSaida),
  });

describe('pipeline nominal', () => {
  it('processa a fixture sem erro bloqueante', () => {
    const resultado = rodar(ENTRADA, 'nominal.md');

    expect(resultado.relatorio.ok).toBe(true);
    expect(resultado.codigo).toBe(CODIGO_DE_SAIDA.ok);
  });

  it('produz exatamente o golden, byte a byte', () => {
    const resultado = rodar(ENTRADA, 'golden.md');
    const esperado = readFileSync(GOLDEN, 'utf8');

    expect(resultado.markdown).toBe(esperado);
    expect(readFileSync(join(temporario, 'golden.md'), 'utf8')).toBe(esperado);
  });

  it('duas execuções produzem os mesmos bytes (RF-003-01)', () => {
    const primeira = rodar(ENTRADA, 'a.md');
    const segunda = rodar(ENTRADA, 'b.md');

    expect(primeira.markdown).toBe(segunda.markdown);
    expect(sha256(primeira.markdown ?? '')).toBe(sha256(segunda.markdown ?? ''));
  });

  it('relata métricas coerentes com a fixture', () => {
    const { relatorio } = rodar(ENTRADA, 'metricas.md');

    if (!relatorio.ok) {
      throw new Error('Esperava relatório ok.');
    }

    expect(relatorio.metricas.artigos).toBe(1);
    expect(relatorio.metricas.dispositivosRevogados).toBe(1);
    // Todo dispositivo é referenciável nesta fixture, então a contagem de
    // Block IDs tem de bater com a de dispositivos.
    expect(relatorio.metricas.blockIdsAtribuidos).toBe(relatorio.metricas.dispositivos);
  });
});

describe('conteúdo canônico (MARKDOWN_SPEC)', () => {
  const markdown = readFileSync(GOLDEN, 'utf8');

  it('termina com exatamente uma newline e usa LF', () => {
    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
    expect(markdown).not.toContain('\r');
  });

  it('não tem espaço nem tab ao final de nenhuma linha', () => {
    const sujas = markdown.split('\n').filter((linha) => /[ \t]$/u.test(linha));

    expect(sujas).toEqual([]);
  });

  it('abre com os treze campos obrigatórios na ordem da §2.1', () => {
    const frontmatter = markdown.split('---')[1] ?? '';
    const chaves = frontmatter
      .trim()
      .split('\n')
      .map((linha) => linha.split(':')[0])
      .filter((chave): chave is string => chave !== undefined && !chave.startsWith(' '));

    expect(chaves.slice(0, 13)).toEqual([
      'title',
      'sigla',
      'tipo',
      'numero',
      'ano',
      'ramo',
      'fonte',
      'data_publicacao',
      'data_atualizacao_legal',
      'data_formatacao_vinculex',
      'total_artigos',
      'versao_vinculex',
      'legal_status',
    ]);
  });

  it('traz os callouts obrigatórios da §6.5', () => {
    expect(markdown).toContain('> [!info] Fonte Oficial');
    expect(markdown).toContain('> [!caution] Aviso de Segurança Jurídica');
  });

  it('não tem callout dentro da árvore de lista (§9 regra 9)', () => {
    const corpo = markdown.slice(markdown.indexOf('- Art.'));

    expect(corpo).not.toContain('> [!');
  });

  it('indenta em múltiplos de dois espaços, sem tabs', () => {
    const itens = markdown.split('\n').filter((linha) => /^\s*- /u.test(linha));

    expect(itens.length).toBeGreaterThan(0);

    for (const item of itens) {
      const recuo = /^(\s*)/u.exec(item)?.[1] ?? '';

      expect(recuo).not.toContain('\t');
      expect(recuo.length % 2).toBe(0);
    }
  });

  it('põe o Block ID como último token, separado por um único espaço (§4)', () => {
    const itens = markdown.split('\n').filter((linha) => linha.includes('^'));

    expect(itens.length).toBeGreaterThan(0);

    for (const item of itens) {
      expect(/[^\s] \^[a-z0-9-]+$/u.test(item)).toBe(true);
    }
  });

  it('não repete Block ID no arquivo (§9 regra 2)', () => {
    const ids = [...markdown.matchAll(/\^([a-z0-9-]+)$/gmu)].map((m) => m[1]);

    expect(ids.length).toBe(new Set(ids).size);
  });

  it('mantém o valor de domínio sem "^" e o prefixo só na serialização', () => {
    const resultado = rodar(ENTRADA, 'dominio.md');
    const arvore = JSON.stringify(resultado.relatorio);

    expect(arvore).not.toContain('^cp-');
  });

  it('reproduz o texto residual de revogação sem riscado (§5.3)', () => {
    // `preservarTextoRevogado` é `false`: a fonte só trouxe o texto residual,
    // então não há redação anterior a riscar.
    expect(markdown).toContain(
      '- VI - (Revogado pela Lei nº 14.994, de 2024) ^cp-art-121-par-2-inc-vi',
    );
    expect(markdown).not.toContain('~~');
  });
});

describe('falha segura', () => {
  it('recusa inciso órfão na etapa de parsing e não grava saída', () => {
    const alvo = join(temporario, 'nao-deve-existir.md');
    const resultado = executarProcess({ entrada: ORFAO, manifesto: MANIFESTO, saida: alvo });

    expect(resultado.codigo).toBe(CODIGO_DE_SAIDA.parsing);
    expect(resultado.relatorio.ok).toBe(false);
    expect(resultado.markdown).toBeUndefined();
    expect(() => readFileSync(alvo, 'utf8')).toThrow();
  });

  it('aponta etapa, linha e motivo (RF-003-05)', () => {
    const resultado = executarProcess({
      entrada: ORFAO,
      manifesto: MANIFESTO,
      saida: join(temporario, 'x.md'),
    });

    if (resultado.relatorio.ok) {
      throw new Error('Esperava falha.');
    }

    const [problema] = resultado.relatorio.problemas;

    expect(problema?.etapa).toBe('parsing');
    expect(problema?.codigo).toBe('dispositivo_orfao');
    expect(problema?.caminho).toEqual(['linhas', 1]);
  });

  it('devolve código de entrada quando o arquivo não existe', () => {
    const resultado = executarProcess({
      entrada: join(FIXTURES, 'inexistente.txt'),
      manifesto: MANIFESTO,
      saida: join(temporario, 'y.md'),
    });

    expect(resultado.codigo).toBe(CODIGO_DE_SAIDA.entrada);
  });

  it('devolve código de escrita quando a gravação falha, sem mascarar sucesso', () => {
    const resultado = executarProcess({
      entrada: ENTRADA,
      manifesto: MANIFESTO,
      saida: join(temporario, 'z.md'),
      escrever: () => {
        throw new Error('disco cheio');
      },
    });

    expect(resultado.codigo).toBe(CODIGO_DE_SAIDA.escrita);
    expect(resultado.relatorio.ok).toBe(false);
  });

  it('recusa linha que não casa com designador suportado', () => {
    const resultado = processar({
      conteudo: 'Art. 1. Caput.\nEsta linha não é um designador.',
      referenciaBase: parsedMinima.sourceRef,
      hashDaLinha: sha256,
      metadados: { ...parsedMinima, sigla: 'x' },
    });

    if (resultado.relatorio.ok) {
      throw new Error('Esperava falha.');
    }

    expect(resultado.relatorio.problemas.map((p) => p.codigo)).toContain('designador_desconhecido');
  });
});

describe('fronteiras entre estágios', () => {
  it('o Formatter recusa uma ParsedNormaAST (RF-003-04)', () => {
    const resultado = formatar(parsedMinima);

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? [] : resultado.problemas.map((p) => p.codigo)).toContain(
      'formatter_exige_identified',
    );
  });

  it('a identificação recusa sigla fora da gramática', () => {
    const resultado = identificar(parsedMinima, 'CP Inválida');

    expect(resultado.ok).toBe(false);
  });

  it('o parser nunca emite Block ID', () => {
    const analisada = analisar({
      conteudo: readFileSync(ENTRADA, 'utf8'),
      referenciaBase: parsedMinima.sourceRef,
      hashDaLinha: sha256,
      metadados: { ...parsedMinima, sigla: 'cp' },
    });

    expect(analisada.ok).toBe(true);
    expect(JSON.stringify(analisada.ok ? analisada.valor : {})).not.toContain('blockId');
  });

  it('a identificação recusa colisão em vez de sufixar contador', () => {
    // Dois artigos com o mesmo número produzem o mesmo candidato. A §7.3 proíbe
    // resolver isso com `-2`: um link estável apontaria para o dispositivo
    // errado, o que é pior do que falhar.
    const resultado = processar({
      conteudo: 'Art. 1. Primeiro.\nArt. 1. Repetido.',
      referenciaBase: parsedMinima.sourceRef,
      hashDaLinha: sha256,
      metadados: { ...parsedMinima, sigla: 'x' },
    });

    if (resultado.relatorio.ok) {
      throw new Error('Esperava falha por colisão.');
    }

    expect(resultado.relatorio.problemas.map((p) => p.codigo)).toContain('block_id_duplicado');
    expect(resultado.relatorio.etapaFinal).toBe('identificacao');
  });
});
