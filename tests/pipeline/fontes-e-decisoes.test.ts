import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  analisar,
  aplicarDecisoesEditoriais,
  identificar,
  mesclarFontes,
  origemHistorica,
  origemMinima,
  parsedMinima,
  type DecisaoEditorial,
  type MetadadosDaNorma,
  type ParsedNormaAST,
} from '@lex-editor/legal-domain';

const sha256 = (valor: string): string => createHash('sha256').update(valor).digest('hex');
const copiar = <T>(valor: T): T => JSON.parse(JSON.stringify(valor)) as T;

const visitar = (no: Record<string, unknown>, fn: (no: Record<string, unknown>) => void): void => {
  fn(no);
  if (Array.isArray(no['children'])) {
    (no['children'] as Record<string, unknown>[]).forEach((filho) => {
      visitar(filho, fn);
    });
  }
};

describe('mesclagem de fontes compilada e anotada (ADR-009)', () => {
  const auxiliar = (): ParsedNormaAST => {
    const arvore = copiar(parsedMinima);
    arvore.fonte = 'https://www.planalto.gov.br/auxiliar.htm';
    visitar(arvore as unknown as Record<string, unknown>, (no) => {
      no['sourceRef'] = { ...origemHistorica };
    });
    const artigo = arvore.children[0] as unknown as Record<string, unknown>;
    artigo['redacoesAnteriores'] = [{ texto: 'Art. 1. Redação anterior sem nota.' }];
    return arvore;
  };

  it('mantém o texto primário e agrega histórico, referência e URL auxiliar', () => {
    const resultado = mesclarFontes(parsedMinima, [auxiliar()]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const artigo = resultado.valor.children[0] as unknown as Record<string, unknown>;
    expect(artigo['caput']).toBe(
      (parsedMinima.children[0] as unknown as Record<string, unknown>)['caput'],
    );
    expect(artigo['redacoesAnteriores']).toEqual([{ texto: 'Art. 1. Redação anterior sem nota.' }]);
    expect(artigo['supportingSourceRefs']).toContainEqual(origemHistorica);
    expect(resultado.valor.fontesSecundarias).toContain('https://www.planalto.gov.br/auxiliar.htm');
  });

  it('tolera apenas diferenças cosméticas de espaços no texto vigente', () => {
    const arvore = auxiliar();
    (arvore.children[0] as unknown as Record<string, unknown>)['caput'] =
      '  Texto   demonstrativo do artigo.  ';
    const primaria = copiar(parsedMinima);
    (primaria.children[0] as unknown as Record<string, unknown>)['caput'] =
      'Texto demonstrativo do artigo.';
    expect(mesclarFontes(primaria, [arvore]).ok).toBe(true);
  });

  it('bloqueia divergência substantiva sem substituir primary_current', () => {
    const arvore = auxiliar();
    (arvore.children[0] as unknown as Record<string, unknown>)['caput'] = 'Texto conflitante.';
    const resultado = mesclarFontes(parsedMinima, [arvore]);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.problemas.map((p) => p.codigo)).toContain('conflito_de_fontes');
  });

  it('mantém a primária e ignora somente o caminho de conflito já revisado', () => {
    const arvore = auxiliar();
    (arvore.children[0] as unknown as Record<string, unknown>)['caput'] = 'Texto conflitante.';
    const resultado = mesclarFontes(parsedMinima, [arvore], {
      conflitosRevisados: ['lei/artigo:1'],
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect((resultado.valor.children[0] as unknown as Record<string, unknown>)['caput']).toBe(
      (parsedMinima.children[0] as unknown as Record<string, unknown>)['caput'],
    );
    expect(
      (resultado.valor.children[0] as unknown as Record<string, unknown>)['supportingSourceRefs'],
    ).toBeUndefined();
  });

  it('aceita a fonte anotada como primária quando não há compilada', () => {
    const anotada = auxiliar();
    visitar(anotada as unknown as Record<string, unknown>, (no) => {
      no['sourceRef'] = { ...origemHistorica, sourceRole: 'primary_current' };
    });

    expect(mesclarFontes(anotada, []).ok).toBe(true);
  });
});

const METADADOS: MetadadosDaNorma = {
  titulo: 'Lei de teste',
  sigla: 'lt',
  tipoNorma: 'lei ordinária',
  numero: '1',
  ano: 2026,
  ramo: 'teste',
  fonte: 'https://example.com/lei',
  dataPublicacao: '2026-01-01',
  dataAtualizacaoLegal: '2026-01-01',
  dataFormatacaoVinculex: '2026-01-01',
  dataVerificacaoIntegridade: '2026-01-01',
  versaoVinculex: '1.0.0',
  legalStatus: 'vigente',
  publicationStatus: 'draft',
};

describe('decisões editoriais versionadas (ADR-011)', () => {
  const conteudo = ['Art. 1. Caput:', '§ 1º Hipóteses:', 'I - conduta:', 'Pena - multa.'].join(
    '\n',
  );

  const analisarCaso = () =>
    analisar({ conteudo, referenciaBase: origemMinima, hashDaLinha: sha256, metadados: METADADOS });

  it('confirma exatamente o fragmento revisado e registra editorial_override', () => {
    const parsed = analisarCaso();
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const decisao: DecisaoEditorial = {
      versao: 1,
      acao: 'confirmar_ancoragem',
      sourceArtifactSha256: origemMinima.sourceArtifactSha256,
      fragmentSha256: sha256('Pena - multa.'),
      rawStartLine: 4,
      justificativa: 'Revisão jurídica confirmou a pena como filha do inciso I.',
    };
    const revisada = aplicarDecisoesEditoriais(parsed.valor, [decisao]);
    expect(revisada.ok).toBe(true);
    if (!revisada.ok) return;
    expect(identificar(revisada.valor, 'lt').ok).toBe(true);

    const inciso = (
      revisada.valor.children[0] as unknown as {
        children: { children: Record<string, unknown>[] }[];
      }
    ).children[0]?.children[0];
    const pena = (inciso?.['children'] as Record<string, unknown>[] | undefined)?.[0];
    expect((pena?.['parseEvidence'] as { reasons?: string[] }).reasons).toContain(
      'editorial_override',
    );
  });

  it('recusa decisão obsoleta que não corresponde ao hash do fragmento', () => {
    const parsed = analisarCaso();
    if (!parsed.ok) throw new Error('fixture inválida');
    const resultado = aplicarDecisoesEditoriais(parsed.valor, [
      {
        versao: 1,
        acao: 'confirmar_ancoragem',
        sourceArtifactSha256: origemMinima.sourceArtifactSha256,
        fragmentSha256: 'f'.repeat(64),
        rawStartLine: 4,
        justificativa: 'Revisão anterior.',
      },
    ]);
    expect(resultado.ok).toBe(false);
  });
});
