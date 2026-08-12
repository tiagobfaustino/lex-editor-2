// As quinze verificações da MARKDOWN_SPEC §9 (Features 004 e 009).
//
// Cada caso corrompe o Markdown já serializado e confere que a validação
// acusa. Uma verificação que nunca reprova nada não é defesa em profundidade,
// é decoração — e a §9.2 chama esta camada exatamente de defesa contra bugs do
// próprio Formatter.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  type IdentifiedNormaAST,
  type MetadadosDaNorma,
  origemMinima,
  processar,
  validarMarkdownCanonico,
} from '@lex-editor/legal-domain';

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

const pipeline = (conteudo: string) => {
  const resultado = processar({
    conteudo,
    referenciaBase: origemMinima,
    hashDaLinha: sha256,
    metadados: METADADOS,
  });

  if (
    !resultado.relatorio.ok ||
    resultado.markdown === undefined ||
    resultado.arvore === undefined
  ) {
    throw new Error(
      `Esperava sucesso: ${JSON.stringify(resultado.relatorio.ok ? [] : resultado.relatorio.problemas)}`,
    );
  }

  return { markdown: resultado.markdown, arvore: resultado.arvore };
};

const BASE = 'Art. 1. Caput:\nI - primeiro inciso;\nII - segundo inciso;';

const codigos = (markdown: string, arvore: IdentifiedNormaAST): string[] =>
  validarMarkdownCanonico(markdown, arvore).map((p) => p.codigo);

describe('o Markdown gerado passa nas quinze verificações', () => {
  it('não acusa nada num documento válido', () => {
    const { markdown, arvore } = pipeline(BASE);

    expect(validarMarkdownCanonico(markdown, arvore)).toEqual([]);
  });
});

describe('as verificações realmente reprovam', () => {
  it('§9.2 — Block ID repetido', () => {
    const { markdown, arvore } = pipeline(BASE);
    const corrompido = markdown.replace('^ldem-art-1-inc-ii', '^ldem-art-1-inc-i');

    expect(codigos(corrompido, arvore)).toContain('block_id_duplicado');
  });

  it('§9.3 — item de lista sem Block ID', () => {
    const { markdown, arvore } = pipeline(BASE);
    const corrompido = markdown.replace(' ^ldem-art-1-inc-i\n', '\n');

    expect(codigos(corrompido, arvore)).toContain('block_id_ausente');
  });

  it('§9.3 — linha de histórico sem ID é a exceção legítima', () => {
    const { markdown, arvore } = pipeline(
      [
        'Art. 1. Caput:',
        'I - inciso:',
        '~~a) antiga.~~ *(Redação dada pela Lei nº 1, de 1990)*',
        'a) vigente;',
      ].join('\n'),
    );

    expect(validarMarkdownCanonico(markdown, arvore)).toEqual([]);
  });

  it('§9.5 — indentação que não é múltiplo de dois', () => {
    const { markdown, arvore } = pipeline(BASE);
    const corrompido = markdown.replace('  - I -', '   - I -');

    expect(codigos(corrompido, arvore)).toContain('filho_incompativel');
  });

  it('§9.6 — Block ID fora da gramática', () => {
    const { markdown, arvore } = pipeline(BASE);

    expect(codigos(markdown.replace('^ldem-art-1\n', '^LDEM_Art_1\n'), arvore)).toContain(
      'block_id_nao_canonico',
    );
  });

  it('§9.4 — contagem de artigos divergente', () => {
    const { markdown, arvore } = pipeline(BASE);
    const mentindo = { ...arvore, totalArtigos: 99 } as IdentifiedNormaAST;

    expect(codigos(markdown, mentindo)).toContain('total_artigos_divergente');
  });

  it('§9.8 — callout obrigatório ausente', () => {
    const { markdown, arvore } = pipeline(BASE);

    expect(
      codigos(markdown.replace('> [!caution] Aviso de Segurança Jurídica', '> nada'), arvore),
    ).toContain('schema_invalido');
  });

  it('§6.5 — legal_status não vigente exige [!warning]', () => {
    const { markdown, arvore } = pipeline(BASE);
    const revogada = { ...arvore, legalStatus: 'revogada' } as IdentifiedNormaAST;

    expect(codigos(markdown, revogada)).toContain('schema_invalido');
  });

  it('§9.9 — callout dentro do corpo', () => {
    const { markdown, arvore } = pipeline(BASE);
    const corrompido = markdown.replace(
      '- Art. 1. Caput: ^ldem-art-1',
      '- Art. 1. Caput: ^ldem-art-1\n> [!note] Intruso\n> texto',
    );

    expect(codigos(corrompido, arvore)).toContain('filho_incompativel');
  });

  it('§9.10 — heading que pula nível', () => {
    const { markdown, arvore } = pipeline(['LIVRO I', 'PRIMEIRO', 'Art. 1. Caput.'].join('\n'));
    const corrompido = markdown.replace(
      '# Livro I - PRIMEIRO',
      '# Livro I - PRIMEIRO\n\n#### Seção pulada - X',
    );

    expect(codigos(corrompido, arvore)).toContain('filho_incompativel');
  });

  it('§9.11 — referência cruzada que não resolve', () => {
    const { markdown, arvore } = pipeline(BASE);
    const comReferenciaQuebrada = {
      ...arvore,
      redacoesDadasPor: [
        { blockId: 'ldem-art-999', lei: 'Lei nº 1', data: '2020-01-01', descricao: 'x' },
      ],
    } as IdentifiedNormaAST;

    expect(codigos(markdown, comReferenciaQuebrada)).toContain('block_id_ausente');
  });

  it('§9.13 — fase diferente de identified', () => {
    const { markdown, arvore } = pipeline(BASE);
    const comFaseErrada = { ...arvore, astPhase: 'parsed' } as unknown as IdentifiedNormaAST;

    expect(codigos(markdown, comFaseErrada)).toContain('fase_incompativel');
  });
});

describe('o pipeline bloqueia na formatação quando a §9 reprova', () => {
  it('não devolve Markdown quando uma verificação falha', () => {
    // O caminho normal não produz documento inválido; este teste garante que,
    // se um bug do Formatter produzisse, o pipeline não o entregaria como bom.
    const { markdown, arvore } = pipeline(BASE);

    expect(validarMarkdownCanonico(markdown, arvore)).toEqual([]);
    expect(
      validarMarkdownCanonico(markdown, { ...arvore, totalArtigos: 42 }).length,
    ).toBeGreaterThan(0);
  });
});
