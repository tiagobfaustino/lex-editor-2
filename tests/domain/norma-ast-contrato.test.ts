// Contrato da NormaAST: fases, invariantes e round-trip.
//
// A `TEST_STRATEGY.md` classifica fidelidade jurídica e invariantes de fase
// como risco crítico e manda automatizar o caso negativo junto do feliz. Cada
// bloco abaixo existe porque a falha correspondente produziria sucesso falso:
// uma árvore aceita que o Formatter depois publicaria errado.

import { describe, expect, it } from 'vitest';

import {
  identifiedCompleta,
  identifiedMinima,
  identifiedNormaAstSchema,
  origemMinima,
  parsedMinima,
  parsedNormaAstSchema,
  type CodigoProblema,
  type ProblemaValidacao,
  type ResultadoValidacao,
  validarIdentifiedNormaAst,
  validarNormaAst,
  validarParsedNormaAst,
} from '@lex-editor/legal-domain';

/**
 * Acesso indexado explícito. O projeto proíbe `!`, e `noUncheckedIndexedAccess`
 * torna todo índice opcional; falhar aqui com mensagem é melhor do que um
 * `undefined` se propagando até uma asserção incompreensível.
 */
const em = <T>(lista: readonly T[] | undefined, indice: number): T => {
  const valor = lista?.[indice];

  if (valor === undefined) {
    throw new Error(`Fixture inesperada: não há elemento no índice ${String(indice)}.`);
  }

  return valor;
};

/** Idem, para o resultado de um `find`. */
const exigir = <T>(valor: T | undefined, oQue: string): T => {
  if (valor === undefined) {
    throw new Error(`Fixture inesperada: ${oQue}.`);
  }

  return valor;
};

/** Clona por JSON para que cada caso mexa numa árvore só sua. */
const clonar = <T>(valor: T): T => JSON.parse(JSON.stringify(valor)) as T;

/**
 * Reconstrói a árvore com as chaves de cada objeto em ordem invertida, sem
 * descartar campo algum. Serve para provar que a forma canônica não depende da
 * ordem em que a entrada foi escrita.
 */
const inverterOrdemDasChaves = (valor: unknown): unknown => {
  if (Array.isArray(valor)) {
    return valor.map(inverterOrdemDasChaves);
  }

  if (typeof valor !== 'object' || valor === null) {
    return valor;
  }

  const invertido: Record<string, unknown> = {};

  for (const chave of Object.keys(valor).reverse()) {
    invertido[chave] = inverterOrdemDasChaves((valor as Record<string, unknown>)[chave]);
  }

  return invertido;
};

const codigos = (resultado: ResultadoValidacao<unknown>): CodigoProblema[] =>
  resultado.ok ? [] : resultado.problemas.map((problema: ProblemaValidacao) => problema.codigo);

const primeiroProblema = (resultado: ResultadoValidacao<unknown>): ProblemaValidacao => {
  if (resultado.ok) {
    throw new Error('Esperava falha de validação, mas o resultado foi ok.');
  }

  const [problema] = resultado.problemas;

  if (problema === undefined) {
    throw new Error('Resultado falhou sem registrar problema algum.');
  }

  return problema;
};

describe('fixtures mínimas', () => {
  it('aceita a árvore parsed mínima', () => {
    expect(validarParsedNormaAst(parsedMinima).ok).toBe(true);
  });

  it('aceita a árvore identified mínima', () => {
    expect(validarIdentifiedNormaAst(identifiedMinima).ok).toBe(true);
  });

  it('aceita a árvore com uma família de cada nó do DATA_MODEL', () => {
    const resultado = validarIdentifiedNormaAst(identifiedCompleta);

    expect(resultado.ok ? [] : resultado.problemas).toEqual([]);
  });

  it('resolve a fase pela raiz quando ela não é informada', () => {
    expect(validarNormaAst(parsedMinima).ok).toBe(true);
    expect(validarNormaAst(identifiedCompleta).ok).toBe(true);
    expect(codigos(validarNormaAst({ astPhase: 'outra' }))).toContain('fase_incompativel');
  });
});

describe('round-trip JSON', () => {
  // O cenário essencial da spec: estrutura e valores semânticos permanecem
  // iguais depois de serializar e ler de volta. Sem isso, persistir ou trocar a
  // árvore entre processos poderia alterar conteúdo jurídico em silêncio.
  it('preserva a árvore identified completa', () => {
    const volta: unknown = JSON.parse(JSON.stringify(identifiedCompleta));
    const resultado = validarIdentifiedNormaAst(volta);

    expect(resultado.ok).toBe(true);
    expect(resultado.ok ? resultado.valor : undefined).toEqual(identifiedCompleta);
  });

  // O escopo da feature pede determinismo "no nível semântico", não byte a
  // byte: a validação reconstrói o objeto na ordem declarada pelo schema, e não
  // na ordem de chaves da entrada. Isso é uma forma canônica — duas árvores
  // semanticamente iguais, escritas com chaves em ordens diferentes, produzem a
  // mesma string. Vale mais que preservar a ordem original, e é o que uma soma
  // de verificação de publicação vai precisar depois.
  it('produz forma canônica independente da ordem das chaves na entrada', () => {
    const original = validarIdentifiedNormaAst(clonar(identifiedCompleta));

    const reordenada = validarIdentifiedNormaAst(
      inverterOrdemDasChaves(clonar(identifiedCompleta)),
    );

    expect(original.ok).toBe(true);
    expect(reordenada.ok).toBe(true);
    expect(JSON.stringify(reordenada.ok ? reordenada.valor : null)).toBe(
      JSON.stringify(original.ok ? original.valor : undefined),
    );
  });

  it('é ponto fixo: revalidar a saída não a altera', () => {
    const primeira = validarIdentifiedNormaAst(clonar(identifiedCompleta));
    const segunda = validarIdentifiedNormaAst(primeira.ok ? primeira.valor : undefined);

    expect(segunda.ok).toBe(true);
    expect(JSON.stringify(segunda.ok ? segunda.valor : null)).toBe(
      JSON.stringify(primeira.ok ? primeira.valor : undefined),
    );
  });

  it('preserva a árvore parsed mínima', () => {
    const volta: unknown = JSON.parse(JSON.stringify(parsedMinima));

    expect(validarParsedNormaAst(volta).ok).toBe(true);
    expect(volta).toEqual(parsedMinima);
  });

  it('não normaliza texto: o valor volta idêntico, inclusive espaços internos', () => {
    const arvore = clonar(parsedMinima);
    const artigo = arvore.children[0];

    if (artigo?.tipo !== 'artigo') {
      throw new Error('Fixture inesperada.');
    }

    artigo.caput = 'Art. 1º  Texto  com  espaços  duplos.';

    const resultado = validarParsedNormaAst(clonar(arvore));

    expect(resultado.ok).toBe(true);
    expect(resultado.ok ? resultado.valor.children[0] : undefined).toMatchObject({
      caput: 'Art. 1º  Texto  com  espaços  duplos.',
    });
  });
});

describe('fase e Block ID (RF-002-02)', () => {
  it('rejeita Block ID na fase parsed', () => {
    const arvore = clonar(parsedMinima) as unknown as {
      children: { blockId?: string }[];
    };

    em(arvore.children, 0).blockId = 'ldem-art-1';

    expect(codigos(validarParsedNormaAst(arvore))).toContain('block_id_proibido');
  });

  it('exige Block ID em nó referenciável na fase identified', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      children: { blockId?: string }[];
    };

    delete em(arvore.children, 0).blockId;

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('schema_invalido');
  });

  it('rejeita Block ID com o prefixo de apresentação do Obsidian', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      children: { blockId?: string }[];
    };

    // O `^` pertence exclusivamente à serialização Markdown; o valor de domínio
    // é canônico. Aceitá-lo aqui vazaria apresentação para dentro do contrato.
    em(arvore.children, 0).blockId = '^ldem-art-1';

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('block_id_nao_canonico');
  });

  it('rejeita Block ID fora da forma canônica', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      children: { blockId?: string }[];
    };

    for (const naoCanonico of ['LDEM-Art-1', 'ldem_art_1', 'ldem--art-1', 'ldem art 1']) {
      em(arvore.children, 0).blockId = naoCanonico;
      expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('block_id_nao_canonico');
    }
  });

  it('recusa a raiz com Block ID', () => {
    const arvore = { ...clonar(identifiedMinima), blockId: 'ldem' };

    expect(validarIdentifiedNormaAst(arvore).ok).toBe(false);
  });

  it('recusa astPhase divergente da fase validada', () => {
    const arvore = { ...clonar(parsedMinima), astPhase: 'identified' };

    expect(validarParsedNormaAst(arvore).ok).toBe(false);
  });

  it('aceita divisão sem Block ID na fase identified', () => {
    // O DATA_MODEL é explícito: divisão estrutural não recebe ID por padrão.
    const resultado = validarIdentifiedNormaAst(identifiedCompleta);

    expect(resultado.ok).toBe(true);

    const livro = resultado.ok ? resultado.valor.children[0] : undefined;

    expect(livro?.tipo).toBe('livro');
    expect(livro && 'blockId' in livro ? livro.blockId : undefined).toBeUndefined();
  });
});

describe('revogação (RF-002-03)', () => {
  it('exige preservarTextoRevogado quando o dispositivo é revogado', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      children: { deviceStatus: string; preservarTextoRevogado?: boolean }[];
    };

    em(arvore.children, 0).deviceStatus = 'revoked';

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('revogacao_sem_decisao');
  });

  it('recusa a decisão fora de um dispositivo revogado', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      children: { deviceStatus: string; preservarTextoRevogado?: boolean }[];
    };

    em(arvore.children, 0).preservarTextoRevogado = true;

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('preservacao_sem_revogacao');
  });

  it('aceita revogado com a decisão explícita', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      children: { deviceStatus: string; preservarTextoRevogado?: boolean }[];
    };

    em(arvore.children, 0).deviceStatus = 'revoked';
    em(arvore.children, 0).preservarTextoRevogado = false;

    expect(validarIdentifiedNormaAst(arvore).ok).toBe(true);
  });
});

describe('tabela', () => {
  const arvoreComTabela = () =>
    clonar(identifiedCompleta) as unknown as {
      children: { children: { tipo: string; headers: string[]; rows: string[][] }[] }[];
    };

  it('recusa linha com contagem de células diferente de headers', () => {
    const arvore = arvoreComTabela();
    const anexo = em(arvore.children, 1);
    const tabela = exigir(
      anexo.children.find((filho) => filho.tipo === 'tabela'),
      'a fixture não tem tabela no anexo',
    );

    tabela.rows = [['a1', 'b1'], ['a2']];

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('tabela_irregular');
  });

  it('recusa linha com células a mais', () => {
    const arvore = arvoreComTabela();
    const tabela = exigir(
      em(arvore.children, 1).children.find((filho) => filho.tipo === 'tabela'),
      'a fixture não tem tabela no anexo',
    );

    tabela.rows = [['a1', 'b1', 'c1']];

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('tabela_irregular');
  });

  it('aponta a linha exata no caminho do problema', () => {
    const arvore = arvoreComTabela();
    const tabela = exigir(
      em(arvore.children, 1).children.find((filho) => filho.tipo === 'tabela'),
      'a fixture não tem tabela no anexo',
    );

    tabela.rows = [['a1', 'b1'], ['a2', 'b2'], ['a3']];

    const resultado = validarIdentifiedNormaAst(arvore);
    const problema = resultado.ok
      ? undefined
      : resultado.problemas.find((p) => p.codigo === 'tabela_irregular');

    expect(problema?.caminho.at(-1)).toBe(2);
  });
});

describe('evidência de parsing (RF-002-04)', () => {
  it('recusa confiança baixa sem pedido de revisão humana', () => {
    const arvore = clonar(parsedMinima) as unknown as {
      children: {
        parseEvidence: { confidence: string; requiresHumanReview: boolean; reasons: string[] };
      }[];
    };

    em(arvore.children, 0).parseEvidence = {
      confidence: 'low',
      requiresHumanReview: false,
      reasons: ['ambiguous_designator'],
    };

    expect(codigos(validarParsedNormaAst(arvore))).toContain('confianca_baixa_sem_revisao');
  });

  it('exige sourceRef em todo nó', () => {
    const arvore = clonar(parsedMinima) as unknown as {
      children: { sourceRef?: unknown }[];
    };

    delete em(arvore.children, 0).sourceRef;

    expect(validarParsedNormaAst(arvore).ok).toBe(false);
  });

  it('aceita evidências complementares sem substituir a principal', () => {
    // ADR-009 §6: `sourceRef` identifica o artefato que sustenta o nó e
    // `supportingSourceRefs` preserva o que apenas complementa.
    const resultado = validarIdentifiedNormaAst(identifiedCompleta);

    expect(resultado.ok).toBe(true);
    expect(resultado.ok ? resultado.valor.sourceRef.sourceRole : undefined).toBe('primary_current');
    expect(resultado.ok ? resultado.valor.supportingSourceRefs?.[0]?.sourceRole : undefined).toBe(
      'historical_auxiliary',
    );
  });

  it('recusa SHA-256 malformado', () => {
    const arvore = clonar(parsedMinima) as unknown as {
      sourceRef: { fragmentSha256: string };
    };

    arvore.sourceRef.fragmentSha256 = 'nao-e-um-sha';

    expect(validarParsedNormaAst(arvore).ok).toBe(false);
  });
});

describe('invariantes estruturais', () => {
  it('recusa id interno duplicado', () => {
    const arvore = clonar(identifiedCompleta) as unknown as { id: string };

    arvore.id = 'no-art-1';

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('id_duplicado');
  });

  it('recusa Block ID repetido em nós diferentes', () => {
    const arvore = clonar(identifiedCompleta) as unknown as {
      children: { blockId: string; children: { blockId: string }[] }[];
    };

    const anexo = em(arvore.children, 1);

    em(anexo.children, 1).blockId = anexo.blockId;

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('block_id_duplicado');
  });

  it('recusa ordem duplicada entre irmãos', () => {
    const arvore = clonar(identifiedCompleta) as unknown as {
      children: { children: { ordem: number }[] }[];
    };

    const anexo = em(arvore.children, 1);

    em(anexo.children, 1).ordem = em(anexo.children, 0).ordem;

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('ordem_duplicada');
  });

  it('recusa filho fora da hierarquia permitida', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      children: { tipo: string; children: unknown[] }[];
    };

    // Item não é filho válido de artigo: a hierarquia exige inciso ou alínea
    // antes. Aceitar isso quebraria a composição cumulativa do Block ID.
    em(arvore.children, 0).children = [
      {
        tipo: 'item',
        id: 'no-item-solto',
        ordem: 0,
        blockId: 'ldem-art-1-item-1',
        sourceRef: origemMinima,
        parseEvidence: { confidence: 'high', reasons: [], requiresHumanReview: false },
        deviceStatus: 'active',
        numero: '1',
        texto: 'item solto',
        children: [],
      },
    ];

    expect(validarIdentifiedNormaAst(arvore).ok).toBe(false);
  });

  it('recusa totalArtigos divergente da contagem real', () => {
    const arvore = { ...clonar(identifiedCompleta), totalArtigos: 99 };

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('total_artigos_divergente');
  });

  it('recusa renumeração para Block ID inexistente', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      children: { renumeradoPara?: string }[];
    };
    em(arvore.children, 0).renumeradoPara = 'ldem-art-999';

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('block_id_ausente');
  });

  it('recusa referência de redação cujo destino não existe na árvore', () => {
    const arvore = clonar(identifiedMinima) as unknown as {
      redacoesDadasPor?: { blockId: string; lei: string; data: string; descricao: string }[];
    };
    arvore.redacoesDadasPor = [
      {
        blockId: 'ldem-art-999',
        lei: 'Lei nº 2',
        data: '2026-01-01',
        descricao: 'Alteração inexistente',
      },
    ];

    expect(codigos(validarIdentifiedNormaAst(arvore))).toContain('block_id_ausente');
  });

  it('recusa campo desconhecido em vez de descartá-lo em silêncio', () => {
    const arvore = { ...clonar(parsedMinima), campoInventado: 'x' };

    expect(validarParsedNormaAst(arvore).ok).toBe(false);
  });

  it('recusa texto normativo vazio', () => {
    const arvore = clonar(parsedMinima) as unknown as { children: { caput: string }[] };

    em(arvore.children, 0).caput = '   ';

    expect(codigos(validarParsedNormaAst(arvore))).toContain('texto_obrigatorio');
  });

  it('recusa dispositivo ativo com nota de revogação', () => {
    const arvore = clonar(parsedMinima) as unknown as {
      children: { notaStatus?: string; deviceStatus: string }[];
    };
    em(arvore.children, 0).deviceStatus = 'active';
    em(arvore.children, 0).notaStatus = 'Revogado pela Lei nº 2';

    expect(codigos(validarParsedNormaAst(arvore))).toContain('estado_incompativel');
  });
});

describe('problemas reportados', () => {
  it('carrega código estável e caminho acionável', () => {
    const arvore = clonar(identifiedCompleta) as unknown as { totalArtigos: number };

    arvore.totalArtigos = 42;

    const problema = primeiroProblema(validarIdentifiedNormaAst(arvore));

    expect(problema.codigo).toBe('total_artigos_divergente');
    expect(problema.caminho).toEqual(['totalArtigos']);
  });

  it('aponta o caminho do nó em problema aninhado', () => {
    const arvore = clonar(parsedMinima) as unknown as { children: { caput: string }[] };

    em(arvore.children, 0).caput = '';

    const problema = primeiroProblema(validarParsedNormaAst(arvore));

    expect(problema.caminho).toEqual(['children', 0, 'caput']);
  });

  it('usa o schema diretamente sem passar pelo validador estrutural', () => {
    expect(parsedNormaAstSchema.safeParse(parsedMinima).success).toBe(true);
    expect(identifiedNormaAstSchema.safeParse(identifiedCompleta).success).toBe(true);
    expect(identifiedNormaAstSchema.safeParse(parsedMinima).success).toBe(false);
  });
});
