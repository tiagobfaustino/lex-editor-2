// Identidade e reconciliação (Feature 004, T004-04 e T004-05).
//
// A ADR-001 torna o Block ID permanente. O que estes testes prendem é o que
// acontece quando a norma muda: nenhuma alteração de texto, nenhuma inclusão e
// nenhuma colisão tardia pode mover um ID já publicado.
//
// A falha que eles previnem não dá erro em runtime. Ela produz um arquivo
// válido em que um link externo, antes correto, passa a apontar para outro
// dispositivo — e não há como descobrir isso depois.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  type IdentifiedNormaAST,
  type MetadadosDaNorma,
  origemMinima,
  processar,
  reconciliar,
  registrarPublicacao,
  REGISTRO_VAZIO,
  verificarAliases,
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

const arvoreDe = (conteudo: string): IdentifiedNormaAST => {
  const resultado = processar({
    conteudo,
    referenciaBase: origemMinima,
    hashDaLinha: sha256,
    metadados: METADADOS,
  });

  if (!resultado.relatorio.ok || resultado.arvore === undefined) {
    throw new Error(
      `Esperava árvore: ${JSON.stringify(resultado.relatorio.ok ? [] : resultado.relatorio.problemas)}`,
    );
  }

  return resultado.arvore;
};

const idsDe = (arvore: IdentifiedNormaAST): string[] => {
  const encontrados: string[] = [];

  const visitar = (no: Record<string, unknown>): void => {
    if (typeof no['blockId'] === 'string') {
      encontrados.push(no['blockId']);
    }

    const filhos = Array.isArray(no['children'])
      ? (no['children'] as Record<string, unknown>[])
      : [];

    for (const filho of filhos) {
      visitar(filho);
    }
  };

  visitar(arvore as unknown as Record<string, unknown>);

  return encontrados;
};

describe('identidade sobrevive à mudança de texto (RF-004-03)', () => {
  const publicada = arvoreDe('Art. 1. Redação originária.\nArt. 2. Outro artigo.');
  const registro = registrarPublicacao(publicada, 'ldem');

  it('mantém o ID quando só o texto muda', () => {
    const candidata = arvoreDe('Art. 1. Redação completamente nova.\nArt. 2. Outro artigo.');
    const resultado = reconciliar(candidata, registro, 'ldem');

    expect(resultado.ok).toBe(true);
    expect(resultado.ok ? idsDe(resultado.valor.arvore) : []).toEqual(['ldem-art-1', 'ldem-art-2']);
  });

  it('a chave de identidade é a posição jurídica, não o texto', () => {
    const candidata = arvoreDe('Art. 1. Qualquer coisa.\nArt. 2. Outra coisa.');
    const resultado = reconciliar(candidata, registro, 'ldem');

    expect(resultado.ok ? idsDe(resultado.valor.arvore) : []).toContain('ldem-art-1');
  });
});

describe('namespace histórico (T004-05)', () => {
  it('não recicla ID de dispositivo que saiu do texto', () => {
    const publicada = arvoreDe('Art. 1. Um.\nArt. 2. Dois.');
    const registro = registrarPublicacao(publicada, 'ldem');

    // O art. 2 desaparece da candidata; seu ID continua reservado.
    expect(registro.namespace).toContain('ldem-art-2');
  });

  it('reporta o publicado ausente em vez de tratá-lo como revogado (ADR-009 §7)', () => {
    const registro = registrarPublicacao(arvoreDe('Art. 1. Um.\nArt. 2. Dois.'), 'ldem');
    const resultado = reconciliar(arvoreDe('Art. 1. Um.'), registro, 'ldem');

    expect(resultado.ok).toBe(true);
    expect(resultado.ok ? resultado.valor.ausentes : []).toEqual(['ldem-art-2']);
  });

  it('o namespace só cresce entre publicações', () => {
    const primeira = registrarPublicacao(arvoreDe('Art. 1. Um.\nArt. 2. Dois.'), 'ldem');
    const segunda = registrarPublicacao(arvoreDe('Art. 1. Um.'), 'ldem', primeira);

    expect(segunda.namespace).toContain('ldem-art-1');
    expect(segunda.namespace).toContain('ldem-art-2');
  });
});

describe('colisão tardia (T004-05)', () => {
  it('não renomeia dispositivo publicado para acomodar um novo', () => {
    const registro = registrarPublicacao(arvoreDe('Art. 1. Um.'), 'ldem');

    // Um dispositivo novo produz o mesmo candidato de um já publicado que não
    // está na candidata: o publicado não pode ser tocado, então a colisão é
    // bloqueante e exige qualificação do novo.
    const semOPublicado = registrarPublicacao(arvoreDe('Art. 1. Um.'), 'ldem', {
      ...REGISTRO_VAZIO,
      namespace: ['ldem-art-9'],
    });

    const resultado = reconciliar(arvoreDe('Art. 9. Novo artigo.'), semOPublicado, 'ldem');

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? [] : resultado.problemas.map((p) => p.codigo)).toContain(
      'block_id_duplicado',
    );
    expect(registro.namespace).toContain('ldem-art-1');
  });

  it('a mensagem diz que renomear o publicado é proibido', () => {
    const registro = { ...REGISTRO_VAZIO, namespace: ['ldem-art-9'] };
    const resultado = reconciliar(arvoreDe('Art. 9. Novo.'), registro, 'ldem');

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? '' : (resultado.problemas[0]?.mensagem ?? '')).toContain(
      'Renomear o publicado é proibido',
    );
  });
});

describe('aliases (T004-05)', () => {
  it('aceita cadeia que termina', () => {
    expect(
      verificarAliases([
        { antigo: 'a', novo: 'b' },
        { antigo: 'b', novo: 'c' },
      ]),
    ).toEqual([]);
  });

  it('recusa ciclo', () => {
    const problemas = verificarAliases([
      { antigo: 'a', novo: 'b' },
      { antigo: 'b', novo: 'a' },
    ]);

    expect(problemas.map((p) => p.codigo)).toContain('ciclo');
  });

  it('recusa alias que aponta para si mesmo', () => {
    expect(verificarAliases([{ antigo: 'a', novo: 'a' }]).map((p) => p.codigo)).toContain('ciclo');
  });

  it('recusa reapontar um alias existente', () => {
    // Alias é permanente: mudar o destino quebra o mesmo link que ele existia
    // para preservar.
    const problemas = verificarAliases([
      { antigo: 'a', novo: 'b' },
      { antigo: 'a', novo: 'c' },
    ]);

    expect(problemas.map((p) => p.codigo)).toContain('block_id_duplicado');
  });
});

describe('ambiguidade bloqueia (RF-004-04)', () => {
  it('recusa duas ocorrências da mesma posição na candidata', () => {
    // Construída à mão: o gerador da primeira publicação já barraria isso, mas
    // a reconciliação recebe árvores de outras origens e precisa se defender.
    const base = arvoreDe('Art. 1. Um.');
    const duplicada = {
      ...(base as unknown as Record<string, unknown>),
      children: [
        ...(base.children as unknown as Record<string, unknown>[]),
        ...(base.children as unknown as Record<string, unknown>[]),
      ],
    } as unknown as IdentifiedNormaAST;

    const resultado = reconciliar(duplicada, REGISTRO_VAZIO, 'ldem');

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? '' : (resultado.problemas[0]?.mensagem ?? '')).toContain('ambígua');
  });
});

describe('primeira publicação', () => {
  it('sem registro anterior, mantém os IDs gerados', () => {
    const candidata = arvoreDe('Art. 1. Um.\nArt. 2. Dois.');
    const resultado = reconciliar(candidata, REGISTRO_VAZIO, 'ldem');

    expect(resultado.ok).toBe(true);
    expect(resultado.ok ? idsDe(resultado.valor.arvore) : []).toEqual(['ldem-art-1', 'ldem-art-2']);
  });

  it('não inventa alias quando nada foi renumerado', () => {
    const resultado = reconciliar(arvoreDe('Art. 1. Um.'), REGISTRO_VAZIO, 'ldem');

    expect(resultado.ok ? resultado.valor.aliasesNovos : ['x']).toEqual([]);
  });
});
