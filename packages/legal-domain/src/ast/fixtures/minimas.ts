// Fixtures mínimas da NormaAST.
//
// São sintéticas de propósito: a ADR-002 registra que testar o contrato com
// árvores construídas à mão, e não com HTML real de uma fonte, é justamente o
// que a camada intermediária torna possível. Os textos abaixo imitam a forma de
// um dispositivo brasileiro sem reproduzir norma alguma.
//
// Cada fixture é a menor árvore que ainda satisfaz o contrato. Crescer uma
// fixture "para cobrir mais" torna o diff de um teste que falha ilegível.

import type {
  IdentifiedNormaAST,
  ParseEvidence,
  ParsedNormaAST,
  SourceReference,
} from '../nodes.js';

const SHA_ARTEFATO = 'a'.repeat(64);
const SHA_FRAGMENTO = 'b'.repeat(64);

/** Referência de origem mínima: a fonte compilada como `primary_current`. */
export const origemMinima: SourceReference = Object.freeze<SourceReference>({
  sourceType: 'planalto_html',
  sourceRole: 'primary_current',
  sourceVariant: 'compiled',
  sourceArtifactSha256: SHA_ARTEFATO,
  fragmentSha256: SHA_FRAGMENTO,
});

/** Evidência complementar: a página anotada como `historical_auxiliary`. */
export const origemHistorica: SourceReference = Object.freeze<SourceReference>({
  sourceType: 'planalto_html',
  sourceRole: 'historical_auxiliary',
  sourceVariant: 'annotated',
  sourceArtifactSha256: 'c'.repeat(64),
  fragmentSha256: 'd'.repeat(64),
});

export const evidenciaAlta: ParseEvidence = Object.freeze<ParseEvidence>({
  confidence: 'high',
  reasons: ['exact_legal_designator'],
  requiresHumanReview: false,
});

/** Confiança baixa exige revisão humana; a fixture respeita a regra. */
export const evidenciaBaixa: ParseEvidence = Object.freeze<ParseEvidence>({
  confidence: 'low',
  reasons: ['ambiguous_designator'],
  requiresHumanReview: true,
});

const metadadosDaLei = {
  tipo: 'lei',
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
  versaoVinculex: '1.0.0',
  legalStatus: 'vigente',
  publicationStatus: 'draft',
  dataVerificacaoIntegridade: '2026-08-05',
} as const;

/**
 * Menor árvore `parsed` válida: raiz e um artigo, sem Block ID em lugar algum.
 */
export const parsedMinima: ParsedNormaAST = {
  ...metadadosDaLei,
  astPhase: 'parsed',
  id: 'no-raiz',
  ordem: 0,
  sourceRef: origemMinima,
  parseEvidence: evidenciaAlta,
  totalArtigos: 1,
  children: [
    {
      tipo: 'artigo',
      id: 'no-art-1',
      ordem: 0,
      sourceRef: origemMinima,
      parseEvidence: evidenciaAlta,
      deviceStatus: 'active',
      numero: '1',
      caput: 'Esta lei demonstra o contrato da NormaAST.',
      children: [],
    },
  ],
};

/**
 * Menor árvore `identified` válida: mesma forma, com Block ID canônico em todo
 * nó referenciável.
 */
export const identifiedMinima: IdentifiedNormaAST = {
  ...metadadosDaLei,
  astPhase: 'identified',
  id: 'no-raiz',
  ordem: 0,
  sourceRef: origemMinima,
  parseEvidence: evidenciaAlta,
  totalArtigos: 1,
  children: [
    {
      tipo: 'artigo',
      id: 'no-art-1',
      ordem: 0,
      blockId: 'ldem-art-1',
      sourceRef: origemMinima,
      parseEvidence: evidenciaAlta,
      deviceStatus: 'active',
      numero: '1',
      caput: 'Esta lei demonstra o contrato da NormaAST.',
      children: [],
    },
  ],
};

/**
 * Uma família de cada, na hierarquia mais profunda que o modelo admite:
 * livro → título → capítulo → seção → subseção → artigo → parágrafo → inciso →
 * alínea → item → pena, mais anexo e tabela. Serve para provar que todo nó de
 * `DATA_MODEL.md` existe em tipo e em schema.
 */
export const identifiedCompleta: IdentifiedNormaAST = {
  ...metadadosDaLei,
  astPhase: 'identified',
  id: 'no-raiz',
  ordem: 0,
  sourceRef: origemMinima,
  supportingSourceRefs: [origemHistorica],
  parseEvidence: evidenciaAlta,
  totalArtigos: 2,
  tags: ['demonstração'],
  revogadaPor: null,
  redacoesDadasPor: [
    {
      blockId: 'ldem-art-1',
      lei: 'Lei nº 9.999, de 2027',
      data: '2027-02-01',
      descricao: 'Nova redação do caput.',
    },
  ],
  idsDepreciados: [{ antigo: 'ldem-art-1-par-1', novo: 'ldem-art-1-par-unico' }],
  fontesSecundarias: ['https://www.planalto.gov.br/ccivil_03/leis/l1234impressao.htm'],
  avisosAtualizacao: ['Conferir a redação do art. 1º na próxima revisão.'],
  notasEditoriais: ['Fixture sintética, sem valor normativo.'],
  children: [
    {
      tipo: 'livro',
      id: 'no-livro-1',
      ordem: 0,
      sourceRef: origemMinima,
      parseEvidence: evidenciaAlta,
      deviceStatus: 'active',
      numero: 'I',
      titulo: 'Da Demonstração',
      children: [
        {
          tipo: 'titulo',
          id: 'no-titulo-1',
          ordem: 0,
          sourceRef: origemMinima,
          parseEvidence: evidenciaAlta,
          deviceStatus: 'active',
          numero: 'I',
          titulo: 'Das Estruturas',
          children: [
            {
              tipo: 'capitulo',
              id: 'no-capitulo-1',
              ordem: 0,
              sourceRef: origemMinima,
              parseEvidence: evidenciaAlta,
              deviceStatus: 'active',
              numero: 'I',
              titulo: 'Das Divisões',
              children: [
                {
                  tipo: 'secao',
                  id: 'no-secao-1',
                  ordem: 0,
                  sourceRef: origemMinima,
                  parseEvidence: evidenciaAlta,
                  deviceStatus: 'active',
                  numero: 'I',
                  titulo: 'Da Seção',
                  children: [
                    {
                      tipo: 'subsecao',
                      id: 'no-subsecao-1',
                      ordem: 0,
                      sourceRef: origemMinima,
                      parseEvidence: evidenciaAlta,
                      deviceStatus: 'active',
                      numero: 'I',
                      titulo: 'Da Subseção',
                      children: [
                        {
                          tipo: 'artigo',
                          id: 'no-art-1',
                          ordem: 0,
                          blockId: 'ldem-art-1',
                          sourceRef: origemMinima,
                          supportingSourceRefs: [origemHistorica],
                          parseEvidence: evidenciaAlta,
                          deviceStatus: 'amended',
                          redacaoAtualDadaPor: 'Lei nº 9.999, de 2027',
                          // Ordem cronológica, da mais antiga para a mais nova
                          // (ADR-006 §4). Não gera nó nem Block ID próprio.
                          redacoesAnteriores: [
                            {
                              texto: 'Art. 1º Redação originária.',
                              nota: '(Redação dada pela Lei nº 8.888, de 2026)',
                            },
                          ],
                          numero: '1',
                          caput: 'A demonstração observará as formas previstas nesta lei.',
                          children: [
                            {
                              tipo: 'paragrafo',
                              id: 'no-art-1-par-unico',
                              ordem: 0,
                              blockId: 'ldem-art-1-par-unico',
                              sourceRef: origemMinima,
                              parseEvidence: evidenciaAlta,
                              deviceStatus: 'active',
                              numero: 'unico',
                              texto: 'As formas são exemplificativas.',
                              children: [
                                {
                                  tipo: 'inciso',
                                  id: 'no-art-1-par-unico-inc-i',
                                  ordem: 0,
                                  blockId: 'ldem-art-1-par-unico-inc-i',
                                  sourceRef: origemMinima,
                                  parseEvidence: evidenciaAlta,
                                  deviceStatus: 'active',
                                  numero: 'I',
                                  texto: 'estruturas hierárquicas;',
                                  children: [
                                    {
                                      tipo: 'alinea',
                                      id: 'no-art-1-par-unico-inc-i-ali-a',
                                      ordem: 0,
                                      blockId: 'ldem-art-1-par-unico-inc-i-ali-a',
                                      sourceRef: origemMinima,
                                      parseEvidence: evidenciaAlta,
                                      deviceStatus: 'active',
                                      letra: 'a',
                                      texto: 'com alíneas;',
                                      children: [
                                        {
                                          tipo: 'item',
                                          id: 'no-art-1-par-unico-inc-i-ali-a-item-1',
                                          ordem: 0,
                                          blockId: 'ldem-art-1-par-unico-inc-i-ali-a-item-1',
                                          sourceRef: origemMinima,
                                          parseEvidence: evidenciaAlta,
                                          deviceStatus: 'active',
                                          numero: '1',
                                          texto: 'e itens;',
                                          children: [
                                            {
                                              tipo: 'pena',
                                              id: 'no-pena-1',
                                              ordem: 0,
                                              blockId:
                                                'ldem-art-1-par-unico-inc-i-ali-a-item-1-pena',
                                              sourceRef: origemMinima,
                                              parseEvidence: evidenciaAlta,
                                              deviceStatus: 'active',
                                              texto: 'Pena - demonstração, de um a dois exemplos.',
                                              children: [],
                                            },
                                          ],
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      tipo: 'anexo',
      id: 'no-anexo-1',
      ordem: 1,
      blockId: 'ldem-anx-i',
      sourceRef: origemMinima,
      parseEvidence: evidenciaAlta,
      deviceStatus: 'active',
      numero: 'I',
      titulo: 'Tabela Oficial',
      children: [
        {
          tipo: 'artigo',
          id: 'no-anexo-1-art-1',
          ordem: 0,
          blockId: 'ldem-anx-i-art-1',
          sourceRef: origemMinima,
          parseEvidence: evidenciaAlta,
          // Revogado com decisão editorial explícita, como manda a RF-002-03.
          deviceStatus: 'revoked',
          preservarTextoRevogado: true,
          notaStatus: '(Revogado pela Lei nº 9.999, de 2027)',
          numero: '1',
          caput: 'Dispositivo revogado do anexo.',
          children: [],
        },
        {
          tipo: 'tabela',
          id: 'no-tabela-1',
          ordem: 1,
          blockId: 'ldem-anx-i-tab-1',
          sourceRef: origemMinima,
          parseEvidence: evidenciaAlta,
          deviceStatus: 'active',
          numero: '1',
          caption: 'Tabela de demonstração',
          headers: ['Coluna A', 'Coluna B'],
          rows: [
            ['a1', 'b1'],
            ['a2', 'b2'],
          ],
          children: [],
        },
      ],
    },
    {
      tipo: 'ato_transitorio',
      id: 'no-adct',
      ordem: 2,
      sourceRef: origemMinima,
      parseEvidence: evidenciaAlta,
      deviceStatus: 'active',
      titulo: 'Ato das Disposições Constitucionais Transitórias',
      children: [],
    },
  ],
};
