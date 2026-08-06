// Tipos públicos da NormaAST, conforme `DATA_MODEL.md` §NormaAST.
//
// Por que interfaces explícitas e não `z.infer` direto: a árvore é recursiva e
// profunda o bastante para o TypeScript recusar serializar o tipo inferido no
// `.d.ts` do pacote (TS7056). Em vez de abrir mão da checagem, `schemas.ts`
// prova em tempo de compilação que o schema construído produz exatamente estas
// interfaces — a prova exigida pelo quinto critério de aceite. Se um campo
// divergir entre as duas formas, o typecheck falha.
//
// A fase é um parâmetro de tipo: em `parsed` o Block ID é `undefined`, em
// `identified` é `string` nos nós referenciáveis. Isso faz a RF-002-02 valer
// também em tempo de compilação, e não apenas em runtime.

import type {
  DeviceStatus,
  LegalStatus,
  ParseConfidence,
  ParseConfidenceReason,
  PublicationStatus,
  SourceRole,
  SourceType,
  SourceVariant,
  TipoNorma,
} from './enums.js';

export interface SourceReference {
  sourceType: SourceType;
  sourceRole: SourceRole;
  sourceVariant: SourceVariant;
  sourceUrl?: string | undefined;
  sourceArtifactSha256: string;
  cssSelector?: string | undefined;
  xpath?: string | undefined;
  rawStartLine?: number | undefined;
  rawEndLine?: number | undefined;
  cleanedStartLine?: number | undefined;
  cleanedEndLine?: number | undefined;
  fragmentSha256: string;
}

export interface ParseEvidence {
  confidence: ParseConfidence;
  reasons: ParseConfidenceReason[];
  requiresHumanReview: boolean;
  editorialNote?: string | undefined;
}

/** Redação anterior como bloco de apresentação (ADR-006 §4). */
export interface RedacaoAnterior {
  texto: string;
  nota: string;
}

export interface ReferenciaRedacao {
  blockId: string;
  lei: string;
  data: string;
  descricao: string;
}

export interface BlockIdDepreciado {
  antigo: string;
  novo: string;
}

/** Campos comuns a todo nó (`NormaNodeBase`). */
export interface NormaNodeBase {
  id: string;
  ordem: number;
  sourceRef: SourceReference;
  supportingSourceRefs?: SourceReference[] | undefined;
  parseEvidence: ParseEvidence;
}

/**
 * O Block ID entra como "slot": um fragmento de forma, não apenas um tipo.
 * Com `exactOptionalPropertyTypes`, ter a propriedade ausente é diferente de
 * tê-la com valor `undefined`, e a fase muda justamente isso — em `parsed` a
 * chave não existe, em `identified` ela é obrigatória no dispositivo.
 */
export interface SlotSemBlockId {
  blockId?: undefined;
}
export interface SlotComBlockId {
  blockId: string;
}
export interface SlotBlockIdOpcional {
  blockId?: string | undefined;
}

type ComumDeDispositivo = NormaNodeBase & {
  deviceStatus: DeviceStatus;
  notaStatus?: string | undefined;
  preservarTextoRevogado?: boolean | undefined;
  redacoesAnteriores?: RedacaoAnterior[] | undefined;
  redacaoAtualDadaPor?: string | undefined;
  renumeradoPara?: string | undefined;
};

export type DispositivoNodeBase<B> = ComumDeDispositivo & B;

/** Divisões nunca exigem Block ID, em nenhuma fase. */
type ComumDeDivisao = NormaNodeBase & {
  deviceStatus: DeviceStatus;
  notaStatus?: string | undefined;
  numero?: string | undefined;
  titulo: string;
};

export type DivisaoNodeBase<D> = ComumDeDivisao & D;

export type PenaNode<B> = DispositivoNodeBase<B> & {
  tipo: 'pena';
  numero?: string | undefined;
  texto: string;
  children: [];
};

export type TabelaNode<B> = DispositivoNodeBase<B> & {
  tipo: 'tabela';
  numero: string;
  caption: string;
  headers: string[];
  rows: string[][];
  children: [];
};

export type ItemNode<B> = DispositivoNodeBase<B> & {
  tipo: 'item';
  numero: string;
  texto: string;
  children: PenaNode<B>[];
};

export type AlineaNode<B> = DispositivoNodeBase<B> & {
  tipo: 'alinea';
  letra: string;
  texto: string;
  children: (ItemNode<B> | PenaNode<B>)[];
};

export type IncisoNode<B> = DispositivoNodeBase<B> & {
  tipo: 'inciso';
  numero: string;
  texto: string;
  children: (AlineaNode<B> | PenaNode<B>)[];
};

export type ParagrafoNode<B> = DispositivoNodeBase<B> & {
  tipo: 'paragrafo';
  numero: string;
  texto: string;
  children: (IncisoNode<B> | AlineaNode<B> | PenaNode<B>)[];
};

export type ArtigoNode<B> = DispositivoNodeBase<B> & {
  tipo: 'artigo';
  numero: string;
  caput: string;
  children: (ParagrafoNode<B> | IncisoNode<B> | AlineaNode<B> | PenaNode<B>)[];
};

export type AnexoNode<B> = DispositivoNodeBase<B> & {
  tipo: 'anexo';
  numero: string;
  titulo: string;
  children: (ArtigoNode<B> | TabelaNode<B>)[];
};

export type SubsecaoNode<B, D> = DivisaoNodeBase<D> & {
  tipo: 'subsecao';
  children: ArtigoNode<B>[];
};

export type SecaoNode<B, D> = DivisaoNodeBase<D> & {
  tipo: 'secao';
  children: (SubsecaoNode<B, D> | ArtigoNode<B>)[];
};

export type CapituloNode<B, D> = DivisaoNodeBase<D> & {
  tipo: 'capitulo';
  children: (SecaoNode<B, D> | ArtigoNode<B>)[];
};

export type TituloNode<B, D> = DivisaoNodeBase<D> & {
  tipo: 'titulo';
  children: (CapituloNode<B, D> | ArtigoNode<B> | AnexoNode<B> | TabelaNode<B>)[];
};

export type LivroNode<B, D> = DivisaoNodeBase<D> & {
  tipo: 'livro';
  children: (TituloNode<B, D> | CapituloNode<B, D> | ArtigoNode<B>)[];
};

/**
 * Raiz. Estende `NormaNodeBase`, não `DispositivoNodeBase`: a lei não tem Block
 * ID nem `deviceStatus`. Seus estados são `legalStatus` e `publicationStatus`,
 * conforme a ADR-005.
 */
export interface LeiNode<Fase, B, D> extends NormaNodeBase {
  tipo: 'lei';
  astPhase: Fase;
  titulo: string;
  sigla: string;
  tipoNorma: TipoNorma;
  numero: string;
  ano: number;
  ramo: string;
  fonte: string;
  dataPublicacao: string;
  dataAtualizacaoLegal: string;
  dataFormatacaoVinculex: string;
  totalArtigos: number;
  versaoVinculex: string;
  legalStatus: LegalStatus;
  publicationStatus: PublicationStatus;
  tags?: string[] | undefined;
  revogadaPor?: string | null | undefined;
  redacoesDadasPor?: ReferenciaRedacao[] | undefined;
  idsDepreciados?: BlockIdDepreciado[] | undefined;
  fontesSecundarias?: string[] | undefined;
  dataVerificacaoIntegridade: string;
  avisosAtualizacao?: string[] | undefined;
  notasEditoriais?: string[] | undefined;
  children: (
    | LivroNode<B, D>
    | TituloNode<B, D>
    | CapituloNode<B, D>
    | ArtigoNode<B>
    | AnexoNode<B>
    | TabelaNode<B>
  )[];
}

export type ParsedNormaAST = LeiNode<'parsed', SlotSemBlockId, SlotSemBlockId>;
export type IdentifiedNormaAST = LeiNode<'identified', SlotComBlockId, SlotBlockIdOpcional>;

/** Qualquer nó filho da árvore em uma fase — tudo menos a raiz. */
export type NormaChildNode<B, D> =
  | LivroNode<B, D>
  | TituloNode<B, D>
  | CapituloNode<B, D>
  | SecaoNode<B, D>
  | SubsecaoNode<B, D>
  | ArtigoNode<B>
  | ParagrafoNode<B>
  | IncisoNode<B>
  | AlineaNode<B>
  | ItemNode<B>
  | PenaNode<B>
  | AnexoNode<B>
  | TabelaNode<B>;

export type ParsedChildNode = NormaChildNode<SlotSemBlockId, SlotSemBlockId>;
export type IdentifiedChildNode = NormaChildNode<SlotComBlockId, SlotBlockIdOpcional>;

/** Qualquer nó, raiz incluída. */
export type NormaNode<Fase, B, D> = LeiNode<Fase, B, D> | NormaChildNode<B, D>;
