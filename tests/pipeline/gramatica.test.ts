// Gramática normativa completa (Feature 004, T004-02).
//
// Um caso mínimo por ramificação, como o `plan.md` exige antes das leis
// inteiras. Os casos são inline em vez de arquivos: cada um cabe em poucas
// linhas, e ler a entrada ao lado da asserção é o que torna o diagnóstico
// rápido quando um deles quebra — que é justamente o risco registrado na spec.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  analisar,
  formatar,
  identificar,
  type MetadadosDaNorma,
  origemMinima,
  processar,
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

const rodar = (conteudo: string, sigla = 'ldem') =>
  processar({
    conteudo,
    referenciaBase: origemMinima,
    hashDaLinha: sha256,
    metadados: { ...METADADOS, sigla },
  });

const markdownDe = (conteudo: string, sigla = 'ldem'): string => {
  const resultado = rodar(conteudo, sigla);

  if (!resultado.relatorio.ok || resultado.markdown === undefined) {
    throw new Error(
      `Esperava sucesso, obtive: ${JSON.stringify(resultado.relatorio.ok ? [] : resultado.relatorio.problemas)}`,
    );
  }

  return resultado.markdown;
};

const idsDe = (markdown: string): string[] =>
  [...markdown.matchAll(/\^([a-z0-9-]+)$/gmu)].map((m) => m[1] ?? '');

describe('divisões estruturais', () => {
  const comTodasAsDivisoes = [
    'LIVRO I',
    'DA PARTE GERAL',
    'TÍTULO II',
    'DOS PRINCÍPIOS',
    'CAPÍTULO III',
    'DAS DEFINIÇÕES',
    'Seção IV - Das Regras',
    'Subseção V - Dos Detalhes',
    'Art. 1. Primeiro artigo.',
  ].join('\n');

  it('mapeia cada divisão ao seu nível de heading (MD §3.1)', () => {
    const md = markdownDe(comTodasAsDivisoes);

    expect(md).toContain('# Livro I - DA PARTE GERAL');
    expect(md).toContain('## Título II - DOS PRINCÍPIOS');
    expect(md).toContain('### Capítulo III - DAS DEFINIÇÕES');
    expect(md).toContain('#### Seção IV - Das Regras');
    expect(md).toContain('##### Subseção V - Dos Detalhes');
  });

  it('aceita ementa na linha seguinte e na mesma linha', () => {
    // O texto do Planalto usa as duas formas.
    const md = markdownDe(comTodasAsDivisoes);

    expect(md).toContain('DA PARTE GERAL');
    expect(md).toContain('Das Regras');
  });

  it('não dá Block ID a divisão (MD §7.3)', () => {
    const md = markdownDe(comTodasAsDivisoes);

    for (const linha of md.split('\n').filter((l) => l.startsWith('#'))) {
      expect(linha).not.toContain('^');
    }

    expect(idsDe(md)).toEqual(['ldem-art-1']);
  });

  it('não põe divisão no Block ID quando não há colisão (BID §2.4)', () => {
    expect(idsDe(markdownDe(comTodasAsDivisoes))).toEqual(['ldem-art-1']);
  });

  it('fecha divisões de nível igual ou mais interno ao abrir a seguinte', () => {
    const md = markdownDe(
      ['CAPÍTULO I', 'PRIMEIRO', 'Art. 1. Um.', 'CAPÍTULO II', 'SEGUNDO', 'Art. 2. Dois.'].join(
        '\n',
      ),
    );

    // Os dois artigos ficam em capítulos irmãos, não aninhados.
    expect(md.indexOf('### Capítulo II')).toBeGreaterThan(md.indexOf('- Art. 1.'));
    expect(idsDe(md)).toEqual(['ldem-art-1', 'ldem-art-2']);
  });
});

describe('desambiguação por divisão (BID §2.4 e §8.3)', () => {
  // Norma que reinicia a numeração de artigos por capítulo: o caso raro que a
  // §2.4 descreve, e a única resolução automática de colisão permitida.
  const numeracaoReiniciada = [
    'CAPÍTULO I',
    'PRIMEIRO',
    'Art. 1. Um do primeiro.',
    'CAPÍTULO II',
    'SEGUNDO',
    'Art. 1. Um do segundo.',
  ].join('\n');

  it('qualifica todos os conflitantes, não só um', () => {
    const ids = idsDe(markdownDe(numeracaoReiniciada));

    expect(ids).toEqual(['ldem-cap-1-art-1', 'ldem-cap-2-art-1']);
  });

  it('usa o ordinal cardinal da divisão, não o romano do texto', () => {
    expect(idsDe(markdownDe(numeracaoReiniciada)).join(' ')).not.toContain('cap-i');
  });

  it('não qualifica quem não colide', () => {
    const ids = idsDe(
      markdownDe(
        [
          'CAPÍTULO I',
          'PRIMEIRO',
          'Art. 1. Um.',
          'CAPÍTULO II',
          'SEGUNDO',
          'Art. 1. Outro um.',
          'Art. 9. Nove, sem par.',
        ].join('\n'),
      ),
    );

    expect(ids).toContain('ldem-cap-1-art-1');
    expect(ids).toContain('ldem-cap-2-art-1');
    expect(ids).toContain('ldem-art-9');
  });

  it('falha quando nenhuma divisão separa os conflitantes', () => {
    const resultado = rodar('Art. 1. Um.\nArt. 1. Um de novo.');

    if (resultado.relatorio.ok) {
      throw new Error('Esperava colisão irredutível.');
    }

    expect(resultado.relatorio.problemas.map((p) => p.codigo)).toContain('block_id_duplicado');
  });
});

describe('dispositivos', () => {
  it('trata o sufixo do artigo como parte do número (BID §2.3.6)', () => {
    expect(idsDe(markdownDe('Art. 121-A. Artigo com sufixo.'))).toEqual(['ldem-art-121-a']);
  });

  it('usa par-unico para parágrafo único (BID §2.3.5)', () => {
    const ids = idsDe(markdownDe('Art. 1. Caput.\nParágrafo único. Um parágrafo só.'));

    expect(ids).toEqual(['ldem-art-1', 'ldem-art-1-par-unico']);
  });

  it('preserva o sufixo do parágrafo', () => {
    const ids = idsDe(markdownDe('Art. 1. Caput.\n§ 2º-A Parágrafo com sufixo.'));

    expect(ids).toContain('ldem-art-1-par-2-a');
  });

  it('aceita inciso com sufixo alfabético', () => {
    const ids = idsDe(markdownDe('Art. 1. Caput:\nVII-A - inciso com sufixo;'));

    expect(ids).toContain('ldem-art-1-inc-vii-a');
  });

  it('aceita alínea de letra dupla (BID §7.2)', () => {
    const ids = idsDe(markdownDe('Art. 1. Caput:\nI - inciso:\naa) alínea de letra dupla;'));

    expect(ids).toContain('ldem-art-1-inc-i-ali-aa');
  });

  it('reconhece item em cardinal arábico (BID §2.3.9)', () => {
    const ids = idsDe(markdownDe('Art. 1. Caput:\nI - inciso:\na) alínea:\n1. primeiro item;'));

    expect(ids).toContain('ldem-art-1-inc-i-ali-a-item-1');
  });

  it('numera a pena só quando a fonte traz a ordem (BID §2.3.12)', () => {
    const semNumero = idsDe(markdownDe('Art. 1. Caput:\nPena - reclusão.'));

    expect(semNumero).toContain('ldem-art-1-pena');
  });

  it('recusa item sem alínea que o anteceda', () => {
    const resultado = rodar('Art. 1. Caput:\n1. item solto;');

    if (resultado.relatorio.ok) {
      throw new Error('Esperava órfão.');
    }

    expect(resultado.relatorio.problemas.map((p) => p.codigo)).toContain('dispositivo_orfao');
  });
});

describe('ancoragem de pena', () => {
  // A dívida que a Feature 003 deixou explícita: no texto plano, uma linha
  // `Pena` pode pertencer ao dispositivo anterior ou a um ancestral.
  it('ancora no único dispositivo que anuncia subordinado', () => {
    const ids = idsDe(markdownDe('Art. 1. Caput sem dois pontos.\nPena - reclusão.'));

    expect(ids).toEqual(['ldem-art-1', 'ldem-art-1-pena']);
  });

  it('ancora no inciso quando só ele anuncia', () => {
    const md = markdownDe(
      ['Art. 1. Caput.', '§ 1º Parágrafo.', 'I - inciso que anuncia:', 'Pena - reclusão.'].join(
        '\n',
      ),
    );

    expect(idsDe(md)).toContain('ldem-art-1-par-1-inc-i-pena');
  });

  it('marca ambiguidade quando mais de um ancestral anuncia', () => {
    // O § anuncia a lista e o inciso também anuncia: o texto plano não
    // resolve. A regra é marcar, não adivinhar.
    const resultado = rodar(
      ['Art. 1. Caput.', '§ 2º Se cometido:', 'I - primeiro caso:', 'Pena - reclusão.'].join('\n'),
    );

    if (resultado.relatorio.ok) {
      throw new Error('Esperava bloqueio por baixa confiança.');
    }

    expect(resultado.relatorio.problemas.map((p) => p.codigo)).toContain(
      'confianca_baixa_sem_revisao',
    );
    expect(resultado.relatorio.etapaFinal).toBe('identificacao');
  });
});

describe('baixa confiança não avança para identificada', () => {
  const ambiguo = ['Art. 1. Caput.', '§ 2º Se cometido:', 'I - caso:', 'Pena - reclusão.'].join(
    '\n',
  );

  it('bloqueia a identificação', () => {
    const analisada = analisar({
      conteudo: ambiguo,
      referenciaBase: origemMinima,
      hashDaLinha: sha256,
      metadados: METADADOS,
    });

    expect(analisada.ok).toBe(true);

    if (!analisada.ok) {
      return;
    }

    expect(identificar(analisada.valor, 'ldem').ok).toBe(false);
  });

  it('permite avançar com decisão editorial explícita', () => {
    // A porta existe para o fluxo de revisão da Feature 006; o pipeline normal
    // não a usa. Um Block ID emitido sobre interpretação duvidosa é permanente.
    const analisada = analisar({
      conteudo: ambiguo,
      referenciaBase: origemMinima,
      hashDaLinha: sha256,
      metadados: METADADOS,
    });

    if (!analisada.ok) {
      throw new Error('Esperava parsing ok.');
    }

    const identificada = identificar(analisada.valor, 'ldem', { permitirBaixaConfianca: true });

    expect(identificada.ok).toBe(true);
    expect(identificada.ok ? formatar(identificada.valor).ok : false).toBe(true);
  });
});
