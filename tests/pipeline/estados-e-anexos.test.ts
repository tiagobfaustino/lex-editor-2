// Estados, histórico de redações, anexos e tabelas (Feature 004, T004-03).
//
// A ADR-005 define os estados, a ADR-006 o histórico e a MARKDOWN_SPEC §5 a
// sinalização. O ponto comum das três é que o Formatter **não pode inferir**:
// a decisão vem da nota oficial, interpretada no parser, e chega ao Formatter
// como campo. Estes testes prendem essa separação.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type MetadadosDaNorma, origemMinima, processar } from '@lex-editor/legal-domain';

const sha256 = (valor: string): string => createHash('sha256').update(valor, 'utf8').digest('hex');

const METADADOS: MetadadosDaNorma = {
  titulo: 'Lei de Demonstração',
  sigla: 'ldem',
  tipoNorma: 'lei ordinária',
  numero: '1.234',
  ano: 2026,
  ramo: 'demonstração',
  fonte: 'https://www.planalto.gov.br/ccivil_03/leis/l1234.htm',
  dataPublicacao: '2026-01-15',
  dataAtualizacaoLegal: '2026-03-10',
  dataFormatacaoVinculex: '2026-08-05',
  dataVerificacaoIntegridade: '2026-08-05',
  versaoVinculex: '1.0.0',
  legalStatus: 'vigente',
  publicationStatus: 'draft',
};

const rodar = (conteudo: string) =>
  processar({ conteudo, referenciaBase: origemMinima, hashDaLinha: sha256, metadados: METADADOS });

const markdownDe = (conteudo: string): string => {
  const resultado = rodar(conteudo);

  if (!resultado.relatorio.ok || resultado.markdown === undefined) {
    throw new Error(
      `Esperava sucesso, obtive: ${JSON.stringify(resultado.relatorio.ok ? [] : resultado.relatorio.problemas)}`,
    );
  }

  return resultado.markdown;
};

/** Percorre a árvore identificada procurando um nó pelo Block ID. */
const noComId = (conteudo: string, blockId: string): Record<string, unknown> => {
  const resultado = rodar(conteudo);

  if (!resultado.relatorio.ok || resultado.arvore === undefined) {
    throw new Error('Esperava árvore identificada.');
  }

  let achado: Record<string, unknown> | undefined;

  const visitar = (no: Record<string, unknown>): void => {
    if (no['blockId'] === blockId) {
      achado = no;
    }

    const filhos = Array.isArray(no['children'])
      ? (no['children'] as Record<string, unknown>[])
      : [];

    for (const filho of filhos) {
      visitar(filho);
    }
  };

  visitar(resultado.arvore as unknown as Record<string, unknown>);

  if (achado === undefined) {
    throw new Error(`Não encontrei o nó ${blockId}.`);
  }

  return achado;
};

describe('estados do dispositivo (ADR-005, MD §5)', () => {
  it('revogado com texto residual não recebe riscado (§5.1.1 e §5.3)', () => {
    const md = markdownDe('Art. 1. Caput.\n§ 1º (Revogado pela Lei nº 9.999, de 2027)');

    expect(md).toContain('- § 1º (Revogado pela Lei nº 9.999, de 2027) ^ldem-art-1-par-1');
    expect(md).not.toContain('~~');
  });

  it('revogado com texto preservado é riscado e leva a nota em itálico (§5.1.2)', () => {
    const md = markdownDe(
      'Art. 1. Caput.\n§ 1º ~~Texto anterior do parágrafo.~~ (Revogado pela Lei nº 9.999, de 2027)',
    );

    expect(md).toContain('~~');
    expect(md).toContain('*Revogado pela Lei nº 9.999, de 2027*');
  });

  it('preserva o Block ID do dispositivo revogado (§5.1.4)', () => {
    const no = noComId(
      'Art. 1. Caput.\n§ 1º (Revogado pela Lei nº 9.999, de 2027)',
      'ldem-art-1-par-1',
    );

    expect(no['deviceStatus']).toBe('revoked');
    expect(no['blockId']).toBe('ldem-art-1-par-1');
  });

  it('registra a decisão editorial explícita de preservação (RF-002-03)', () => {
    const no = noComId(
      'Art. 1. Caput.\n§ 1º (Revogado pela Lei nº 1, de 2020)',
      'ldem-art-1-par-1',
    );

    expect(no['preservarTextoRevogado']).toBe(false);
  });

  it('reconhece veto', () => {
    const no = noComId('Art. 1. Caput.\n§ 4º (Vetado)', 'ldem-art-1-par-4');

    expect(no['deviceStatus']).toBe('vetoed');
  });

  it('prioriza veto ou revogação em caixa alta mesmo com outra anotação posterior', () => {
    const vetado = noComId(
      'Art. 1. Caput.\n§ 4º (VETADO) (Incluído pela Lei nº 8.888, de 2026)',
      'ldem-art-1-par-4',
    );
    const revogado = noComId(
      'Art. 1. Caput.\n§ 5º (Revogado). (Redação dada pela Lei nº 8.888, de 2026) Vigência',
      'ldem-art-1-par-5',
    );

    expect(vetado['deviceStatus']).toBe('vetoed');
    expect(revogado['deviceStatus']).toBe('revoked');
  });

  it('reconhece inclusão e alteração pela nota oficial', () => {
    const incluido = noComId(
      'Art. 1. Caput.\n§ 2º Texto novo. (Incluído pela Lei nº 8.888, de 2026)',
      'ldem-art-1-par-2',
    );

    expect(incluido['deviceStatus']).toBe('included');
    expect(incluido['redacaoAtualDadaPor']).toBe('Incluído pela Lei nº 8.888, de 2026');

    const alterado = noComId(
      'Art. 1. Caput.\n§ 3º Texto atual. (Redação dada pela Lei nº 7.777, de 2025)',
      'ldem-art-1-par-3',
    );

    expect(alterado['deviceStatus']).toBe('amended');
    expect(alterado['redacaoAtualDadaPor']).toBe('Redação dada pela Lei nº 7.777, de 2025');
  });

  it('reconhece suspensão e renumeração', () => {
    expect(
      noComId('Art. 1. Caput.\n§ 5º Texto. (Suspenso pela Resolução nº 5)', 'ldem-art-1-par-5')[
        'deviceStatus'
      ],
    ).toBe('suspended');

    expect(
      noComId('Art. 1. Caput.\n§ 6º Texto. (Renumerado pela Lei nº 3)', 'ldem-art-1-par-6')[
        'deviceStatus'
      ],
    ).toBe('renumbered');
  });

  it('extrai a nota sem alterar o texto normativo restante', () => {
    const no = noComId(
      'Art. 1. Caput.\n§ 2º O prazo é de 30 (trinta) dias. (Incluído pela Lei nº 8.888, de 2026)',
      'ldem-art-1-par-2',
    );

    expect(no['texto']).toBe('O prazo é de 30 (trinta) dias.');
  });

  it('deixa parentético que não é nota conhecida dentro do texto', () => {
    const no = noComId('Art. 1. Caput.\n§ 2º O prazo é de 30 (trinta) dias.', 'ldem-art-1-par-2');

    expect(no['texto']).toBe('O prazo é de 30 (trinta) dias.');
    expect(no['deviceStatus']).toBe('active');
  });
});

describe('histórico de redações (ADR-006)', () => {
  const comHistorico = [
    'Art. 61. Caput.',
    'II - inciso:',
    '~~h) contra criança, velho, enfermo ou mulher grávida.~~ *(Redação dada pela Lei nº 9.318, de 1996)*',
    'h) contra criança, maior de 60 (sessenta) anos, enfermo ou mulher grávida; (Redação dada pela Lei nº 10.741, de 2003)',
  ].join('\n');

  it('acumula a linha riscada como redação anterior do próximo dispositivo (§2)', () => {
    const no = noComId(comHistorico, 'ldem-art-61-inc-ii-ali-h');
    const redacoes = no['redacoesAnteriores'];

    expect(Array.isArray(redacoes)).toBe(true);
    expect((redacoes as { texto: string }[])[0]?.texto).toContain('velho');
  });

  it('não dá Block ID à linha de histórico', () => {
    const md = markdownDe(comHistorico);
    const linhaDeHistorico = md.split('\n').find((l) => l.includes('velho'));

    expect(linhaDeHistorico).toBeDefined();
    expect(linhaDeHistorico).not.toContain('^');
  });

  it('põe o histórico imediatamente acima da redação vigente, na mesma indentação', () => {
    const linhas = markdownDe(comHistorico).split('\n');
    const iHistorico = linhas.findIndex((l) => l.includes('velho'));
    const iVigente = linhas.findIndex((l) => l.includes('maior de 60'));

    expect(iVigente).toBe(iHistorico + 1);
    expect(/^(\s*)/u.exec(linhas[iHistorico] ?? '')?.[1]).toBe(
      /^(\s*)/u.exec(linhas[iVigente] ?? '')?.[1],
    );
  });

  it('preserva a ordem cronológica de várias redações (§4)', () => {
    const no = noComId(
      [
        'Art. 1. Caput:',
        'I - inciso:',
        '~~a) mais antiga.~~ *(Redação dada pela Lei nº 1, de 1990)*',
        '~~a) intermediária.~~ *(Redação dada pela Lei nº 2, de 2000)*',
        'a) vigente; (Redação dada pela Lei nº 3, de 2010)',
      ].join('\n'),
      'ldem-art-1-inc-i-ali-a',
    );

    const redacoes = no['redacoesAnteriores'] as { texto: string }[];

    expect(redacoes.map((r) => r.texto)).toEqual(['a) mais antiga.', 'a) intermediária.']);
  });

  it('preserva histórico sem inventar nota ausente (ADR-011)', () => {
    const md = markdownDe(['~~Art. 1. Texto anterior.~~', 'Art. 1. Texto vigente.'].join('\n'));
    const linha = md.split('\n').find((item) => item.includes('Texto anterior'));

    expect(linha).toBe('- ~~Art. 1. Texto anterior.~~');
  });

  it('distingue histórico de revogação: a nota decide (§5.5)', () => {
    // Riscado com nota de redação e sem Block ID vira histórico; o dispositivo
    // que o segue continua vigente.
    const vigente = noComId(comHistorico, 'ldem-art-61-inc-ii-ali-h');

    expect(vigente['deviceStatus']).toBe('amended');
  });

  it('a contagem de artigos vem da AST, não de itens de nível 0 (§9.4)', () => {
    const md = markdownDe(comHistorico);

    expect(md).toContain('total_artigos: 1');
  });
});

describe('anexos e tabelas (DM §Anexos, MD §3.3)', () => {
  const comAnexo = [
    'ANEXO I',
    'Tabela Oficial',
    'Art. 1. Dispositivo dentro do anexo.',
    'Tabela 1. Demonstrativo oficial | Código; Descrição | A; Ativo / B; Suspenso',
  ].join('\n');

  it('serializa o anexo como heading de nível 2 com Block ID (§3.3)', () => {
    expect(markdownDe(comAnexo)).toContain('## Anexo I - Tabela Oficial ^ldem-anx-i');
  });

  it('normaliza anexo único sem inventar numeração', () => {
    const markdown = markdownDe(
      'Art. 1. Corpo da lei.\n' +
        'ANEXO\nTabela Oficial\nTabela 1. Demonstrativo | Código; Valor | A; 1',
    );

    expect(markdown).toContain('## Anexo único - Tabela Oficial ^ldem-anx-unico');
    expect(markdown).toContain('^ldem-anx-unico-tab-1');
  });

  it('reconhece anexo único quando nota e título vêm concatenados pelo HTML', () => {
    const markdown = markdownDe(
      'Art. 1. Corpo da lei.\n' +
        'ANEXO (Redação dada pela Lei nº 2, de 2026) TABELA DE TAXAS\n' +
        'Tabela 1. Demonstrativo | Código; Valor | A; 1',
    );

    expect(markdown).toContain('## Anexo único - TABELA DE TAXAS ^ldem-anx-unico');
    expect(markdown).toContain('^ldem-anx-unico-tab-1');
  });

  it('faz o artigo dentro do anexo carregar o segmento (BID §2.3.10)', () => {
    expect(markdownDe(comAnexo)).toContain('^ldem-anx-i-art-1');
  });

  it('serializa a tabela numa linha canônica (§3.3.3)', () => {
    expect(markdownDe(comAnexo)).toContain(
      '- Tabela 1. Demonstrativo oficial | Código; Descrição | A; Ativo / B; Suspenso ^ldem-anx-i-tab-1',
    );
  });

  it('referencia a tabela inteira, não linha nem célula', () => {
    const ids = [...markdownDe(comAnexo).matchAll(/\^([a-z0-9-]+)$/gmu)].map((m) => m[1]);

    expect(ids.filter((id) => id?.includes('tab-'))).toEqual(['ldem-anx-i-tab-1']);
  });

  it('recusa tabela com linha irregular antes de serializar (§9.12)', () => {
    const resultado = rodar(
      [
        'ANEXO I',
        'Tabela Oficial',
        'Art. 1. Caput.',
        'Tabela 1. Irregular | Código; Descrição | A; Ativo / B',
      ].join('\n'),
    );

    if (resultado.relatorio.ok) {
      throw new Error('Esperava recusa da tabela irregular.');
    }

    expect(resultado.relatorio.problemas.map((p) => p.codigo)).toContain('tabela_irregular');
  });
});
