# Modelo de Dados — Vinculex

> Modelo de dados conceitual compartilhado entre Lex Editor e Vinculex SaaS.
> Complementa `./SYSTEM_ARCHITECTURE.md`. Para a especificação formal de Block IDs, ver `./BLOCK_ID_SPEC.md`;
> para o formato de arquivo Markdown, ver `./MARKDOWN_SPEC.md`.

## Sumário

- [NormaAST](#normaast)
- [Metadados de frontmatter](#metadados-de-frontmatter)
- [Schema Postgres/Supabase](#schema-postgressupabase)
- [Relacionamentos entre tabelas](#relacionamentos-entre-tabelas)
- [Schema do Vinculex SaaS](#schema-do-vinculex-saas)
- [Row Level Security](#row-level-security)
- [Estratégia de versionamento de dados](#estratégia-de-versionamento-de-dados)

---

## NormaAST

> Nota: os campos de status seguem `./ADR-005-status-fields.md` — três campos
> distintos e não um `status` genérico. `LeiNode` carrega `legalStatus`
> (vigência jurídica) e `publicationStatus` (fluxo editorial); os demais nós
> carregam `deviceStatus` (estado do dispositivo).

A NormaAST é a árvore normativa intermediária produzida pelo Parser. Existem
duas fases validadas do mesmo contrato:

- `ParsedNormaAST`: saída do Parser; nenhum dispositivo possui `blockId`;
- `IdentifiedNormaAST`: saída do reconciliador; todo dispositivo referenciável
  possui `blockId`, enquanto divisões estruturais continuam sem ID por padrão.

O Formatter e a publicação aceitam exclusivamente `IdentifiedNormaAST`. Todo
nó compartilha `id`, `ordem`, rastreabilidade de origem e evidência da decisão
do parser. Os campos de status vivem em `LeiNode` (`legalStatus`,
`publicationStatus`) ou nos demais nós (`deviceStatus`), nunca em um campo
`status` único.

### Tipos base

```typescript
type LegalStatus = 'vigente' | 'revogada' | 'alterada' | 'suspensa' | 'sem_eficacia' | 'desconhecida';
type PublicationStatus = 'draft' | 'review' | 'approved' | 'published' | 'archived' | 'outdated';
type DeviceStatus = 'active' | 'revoked' | 'vetoed' | 'included' | 'amended' | 'renumbered' | 'suspended' | 'unknown';
type AstPhase = 'parsed' | 'identified';
type ParseConfidence = 'high' | 'medium' | 'low';
type SourceRole = 'primary_current' | 'historical_auxiliary' | 'cross_check';
type SourceVariant = 'compiled' | 'annotated' | 'other';
type ParseConfidenceReason =
  | 'exact_legal_designator'
  | 'known_source_markup'
  | 'hierarchy_inferred_from_context'
  | 'ambiguous_designator'
  | 'irregular_table'
  | 'source_markup_lost'
  | 'editorial_override';
type TipoNorma =
  | 'lei ordinária'
  | 'lei complementar'
  | 'decreto-lei'
  | 'decreto'
  | 'medida provisória'
  | 'emenda constitucional'
  | 'código'
  | 'constituição';

interface NormaNodeBase {
  /** Identificador interno de runtime, não persistido como Block ID */
  id: string;
  /** Posição do nó entre seus irmãos, para preservar ordem de exibição */
  ordem: number;
  /** Localiza este nó no snapshot imutável da fonte e no texto limpo. */
  sourceRef: SourceReference;
  /** Evidências complementares, sem substituir a referência principal. */
  supportingSourceRefs?: SourceReference[];
  /** Explica a confiança da interpretação estrutural; não é só um score opaco. */
  parseEvidence: ParseEvidence;
}

interface SourceReference {
  sourceType: 'planalto_html' | 'lexml_xml' | 'markdown' | 'local_file';
  /** Função deste artefato no conjunto de fontes definido na ADR-009. */
  sourceRole: SourceRole;
  /** Forma publicada da fonte; não determina sozinha a sua precedência. */
  sourceVariant: SourceVariant;
  sourceUrl?: string;
  sourceArtifactSha256: string;
  cssSelector?: string;
  xpath?: string;
  rawStartLine?: number;
  rawEndLine?: number;
  cleanedStartLine?: number;
  cleanedEndLine?: number;
  fragmentSha256: string;
}

interface ParseEvidence {
  confidence: ParseConfidence;
  reasons: ParseConfidenceReason[];
  requiresHumanReview: boolean;
  editorialNote?: string;
}

/** Base para nós que representam um dispositivo individual (não a lei em si) */
interface DispositivoNodeBase extends NormaNodeBase {
  /**
   * Block ID canônico sem o prefixo de apresentação do Obsidian,
   * ex.: cp-art-121-par-2-inc-viii
   */
  blockId?: string;
  /** Estado individual do dispositivo dentro da NormaAST (ver ADR-005) */
  deviceStatus: DeviceStatus;
  /** Texto explicativo quando revogado/vetado, ex. "Revogado pela Lei nº X" */
  notaStatus?: string;
  /**
   * Decisão editorial explícita para dispositivos revogados.
   * Obrigatório quando deviceStatus = 'revoked'; ausente nos demais estados.
   */
  preservarTextoRevogado?: boolean;
  /**
   * Histórico de redações anteriores materializado no corpo (ver ADR-006),
   * ordenado da mais antiga para a mais nova. Cada entrada é apresentação
   * (bloco riscado), não gera nó próprio nem Block ID. O texto/caput do nó
   * permanece a redação vigente.
   */
  redacoesAnteriores?: { texto: string; nota: string }[];
  /** Norma que conferiu a redação atualmente vigente, quando aplicável. */
  redacaoAtualDadaPor?: string;
  /** Destino canônico quando este nó representa uma posição renumerada. */
  renumeradoPara?: string;
}

/** União de todos os tipos de nó reconhecidos pela NormaAST */
type NormaNode =
  | LeiNode
  | LivroNode
  | TituloNode
  | CapituloNode
  | SecaoNode
  | SubsecaoNode
  | ArtigoNode
  | ParagrafoNode
  | IncisoNode
  | AlineaNode
  | ItemNode
  | PenaNode
  | AnexoNode
  | TabelaNode;
```

### Nó raiz

```typescript
interface LeiNode extends NormaNodeBase {
  tipo: 'lei';
  astPhase: AstPhase;
  titulo: string;              // ex.: "Código Penal"
  sigla: string;               // ex.: "cp"
  tipoNorma: TipoNorma;        // ex.: "decreto-lei"
  numero: string;               // ex.: "2.848"
  ano: number;                  // ex.: 1940
  ramo: string;                 // ex.: "penal"
  fonte: string;                // URL da fonte primary_current
  dataPublicacao: string;       // date YYYY-MM-DD
  dataAtualizacaoLegal: string; // date YYYY-MM-DD
  dataFormatacaoVinculex: string; // date YYYY-MM-DD
  totalArtigos: number;         // derivado dos children e validado antes do formatter
  versaoVinculex: string;       // semver, ex.: "1.3.0"
  /** Vigência jurídica da lei perante o ordenamento (ver ADR-005) */
  legalStatus: LegalStatus;
  /** Fluxo editorial dentro do Vinculex (ver ADR-005) */
  publicationStatus: PublicationStatus;
  /** Metadados opcionais serializados no frontmatter canônico */
  tags?: string[];
  revogadaPor?: string | null;
  redacoesDadasPor?: ReferenciaRedacao[];
  idsDepreciados?: BlockIdDepreciado[];
  fontesSecundarias?: string[]; // URLs historical_auxiliary/cross_check
  /**
   * Metadado interno usado no callout obrigatório de fonte oficial.
   * Não deve ser obtida do relógio durante a formatação.
   */
  dataVerificacaoIntegridade: string; // date YYYY-MM-DD
  /** Conteúdo semântico dos callouts opcionais; o formatter controla a sintaxe */
  avisosAtualizacao?: string[];
  notasEditoriais?: string[];
  children: (LivroNode | TituloNode | CapituloNode | ArtigoNode | AnexoNode | TabelaNode)[];
}

interface ReferenciaRedacao {
  blockId: string;
  lei: string;
  data: string;       // date YYYY-MM-DD
  descricao: string;
}

interface BlockIdDepreciado {
  antigo: string;
  novo: string;
}
```

Os schemas de runtime são normativos, não apenas auxiliares:

- `ParsedNormaASTSchema` exige `astPhase: 'parsed'`, proíbe `blockId` em
  dispositivos e valida `sourceRef`/`supportingSourceRefs`/`parseEvidence`;
- `IdentifiedNormaASTSchema` exige `astPhase: 'identified'` e `blockId` em
  artigo, parágrafo, inciso, alínea, item, pena, anexo e tabela;
- ambos rejeitam nós desconhecidos, filhos incompatíveis, ciclos, ordens
  duplicadas entre irmãos e evidência de baixa confiança sem
  `requiresHumanReview: true`;
- o tipo TypeScript de cada fase deve ser inferido do respectivo schema de
  runtime, evitando manter manualmente dois contratos divergentes.

Todos os campos `blockId`/`block_id` deste modelo armazenam o valor canônico
sem `^`. O prefixo pertence exclusivamente à serialização Markdown. URLs HTML,
chaves de banco e payloads de API usam, por exemplo,
`cp-art-121-par-2-inc-viii`; o Formatter produz
`^cp-art-121-par-2-inc-viii`.

### Anexos e tabelas oficiais suportados

Anexos e tabelas extraídos de fontes oficiais permitidas são representados na
NormaAST somente quando a estrutura for determinística e validada pelo pipeline.
Estruturas ambíguas, mescladas, incompletas ou sem identidade jurídica mínima
falham antes de chegar ao Preview.

```typescript
interface AnexoNode extends DispositivoNodeBase {
  tipo: 'anexo';
  numero: string;       // ex.: "I"
  titulo: string;       // ex.: "Tabela Oficial"
  children: (ArtigoNode | TabelaNode)[];
}

interface TabelaNode extends DispositivoNodeBase {
  tipo: 'tabela';
  numero: string;
  caption: string;
  headers: string[];
  rows: string[][];
  children: [];
}
```

Regras específicas:

1. `AnexoNode` identifica a divisão jurídica do anexo e pode conter dispositivos
   textuais suportados ou tabelas simples suportadas.
2. `TabelaNode` é um bloco jurídico referenciável no nível da tabela inteira.
   Linhas e células são conteúdo ordenado dentro da tabela e não recebem
   Block IDs nesta versão.
3. `headers.length` define a contagem de colunas; cada linha em `rows` deve ter
   exatamente a mesma quantidade de células.
4. O renderer recebe apenas projeções de Preview derivadas da NormaAST validada,
   nunca HTML bruto, Markdown integral, seletores ou payloads completos.

### Nós de divisão (estrutura hierárquica)

```typescript
interface DivisaoNodeBase extends NormaNodeBase {
  /**
   * Divisões não recebem Block ID por padrão. O campo só existe quando a
   * extensão opcional de link direto para divisão for adotada explicitamente.
   */
  blockId?: string;
  deviceStatus: DeviceStatus;
  notaStatus?: string;
  numero?: string;   // ex.: "I", "II" — nem toda divisão é numerada
  titulo: string;    // ex.: "Dos Crimes Contra a Pessoa"
}

interface LivroNode extends DivisaoNodeBase {
  tipo: 'livro';
  children: (TituloNode | CapituloNode | ArtigoNode)[];
}

interface TituloNode extends DivisaoNodeBase {
  tipo: 'titulo';
  children: (CapituloNode | ArtigoNode | AnexoNode | TabelaNode)[];
}

interface CapituloNode extends DivisaoNodeBase {
  tipo: 'capitulo';
  children: (SecaoNode | ArtigoNode)[];
}

interface SecaoNode extends DivisaoNodeBase {
  tipo: 'secao';
  children: (SubsecaoNode | ArtigoNode)[];
}

interface SubsecaoNode extends DivisaoNodeBase {
  tipo: 'subsecao';
  children: ArtigoNode[];
}
```

### Nó de artigo e seus filhos

```typescript
interface ArtigoNode extends DispositivoNodeBase {
  tipo: 'artigo';
  numero: string;                 // ex.: "121", "121-A" (artigos com sufixo)
  caput: string;                  // texto do caput, sem os incisos/parágrafos
  children: (ParagrafoNode | IncisoNode | PenaNode)[];
}

interface ParagrafoNode extends DispositivoNodeBase {
  tipo: 'paragrafo';
  numero: string | 'unico';       // "1", "2", ... ou "unico"
  texto: string;
  children: (IncisoNode | PenaNode)[];
}

interface IncisoNode extends DispositivoNodeBase {
  tipo: 'inciso';
  numero: string;                 // numeração romana, ex.: "VIII"
  texto: string;
  children: (AlineaNode | PenaNode)[];
}

interface AlineaNode extends DispositivoNodeBase {
  tipo: 'alinea';
  letra: string;                  // ex.: "a", "b"
  texto: string;
  children: (ItemNode | PenaNode)[];
}

interface ItemNode extends DispositivoNodeBase {
  tipo: 'item';
  numero: string;                 // numeração arábica, ex.: "1", "2"
  texto: string;
  children: PenaNode[];
}

interface PenaNode extends DispositivoNodeBase {
  tipo: 'pena';
  numero?: string;                // ausente quando há uma única pena no pai
  texto: string;
  children: never[];
}
```

Notas de modelagem:

- `deviceStatus: 'revoked' | 'vetoed'` se aplica a qualquer nível (artigo inteiro, um único inciso, uma alínea), refletindo a granularidade real da legislação brasileira.
- Em `ParsedNormaAST`, `blockId` está ausente. Em `IdentifiedNormaAST`, ele é
  obrigatório em artigo, parágrafo, inciso, alínea, item, pena, anexo e tabela. Em
  divisões estruturais é opcional e ausente por padrão; a raiz não possui ID.
- `preservarTextoRevogado` é obrigatório quando `deviceStatus` for `revoked`. O Formatter não pode inferir essa decisão a partir do texto ou da fonte.
- Os campos de Markdown em `LeiNode` são dados semânticos da NormaAST. Ordem de chaves YAML, indentação, marcadores e sintaxe de callout permanecem responsabilidade exclusiva do Formatter.
- Intervalos de artigos por divisão (ex.: "Arts. 121 a 154 — Dos Crimes Contra a Pessoa") não são um tipo de nó separado; são derivados dos `children` de `CapituloNode`/`SecaoNode` no momento da renderização, evitando duplicar a fonte de verdade da ordem dos artigos.
- `redacaoAtualDadaPor`, `redacoesAnteriores` e `renumeradoPara` vivem em
  `DispositivoNodeBase`, pois alterações e renumerações podem ocorrer abaixo
  do nível de artigo.
- Toda entrada de `sourceRef` ou `supportingSourceRefs` aponta para um snapshot
  identificado por SHA-256; seletores e intervalos são evidência de
  localização, nunca a única garantia de integridade.

---

## Metadados de frontmatter

Mapeamento entre os campos de frontmatter do Markdown (ver `./MARKDOWN_SPEC.md` para a sintaxe exata) e os campos estruturados do modelo de dados.

| Campo no frontmatter | Campo estruturado equivalente | Tipo | Origem |
|---|---|---|---|
| `title` | `LeiNode.titulo` | `string` | Preenchido na importação, editável |
| `sigla` | `LeiNode.sigla` | `string` | Preenchido na importação, imutável após publicação |
| `tipo` | `LeiNode.tipoNorma` | `TipoNorma` | Preenchido na importação |
| `numero` | `LeiNode.numero` | `string` | Extraído da fonte oficial |
| `ano` | `LeiNode.ano` | `number` | Extraído da fonte oficial |
| `ramo` | `LeiNode.ramo` | `string` | Classificação editorial |
| `fonte` | `LeiNode.fonte` | `string` (URL) | URL informada na importação |
| `data_publicacao` | `LeiNode.dataPublicacao` | `string` (`YYYY-MM-DD`) | Extraído da fonte oficial |
| `data_atualizacao_legal` | `LeiNode.dataAtualizacaoLegal` | `string` (`YYYY-MM-DD`) | Data da última alteração normativa incorporada |
| `data_formatacao_vinculex` | `LeiNode.dataFormatacaoVinculex` | `string` (`YYYY-MM-DD`) | Fixado antes da formatação; o Formatter não consulta o relógio |
| `total_artigos` | `LeiNode.totalArtigos` | `number` | Calculado dos `children` e validado |
| `versao_vinculex` | `LeiNode.versaoVinculex` | `string` (semver) | Incrementado pelo fluxo editorial |
| `legal_status` | `LeiNode.legalStatus` | `LegalStatus` | Vigência jurídica da lei; ver `./ADR-005-status-fields.md` |
| `tags` | `LeiNode.tags` | `string[]` | Classificação editorial opcional |
| `revogada_por` | `LeiNode.revogadaPor` | `string \| null` | Norma revogadora, quando aplicável |
| `redacao_dada_por` | `LeiNode.redacoesDadasPor` | `ReferenciaRedacao[]` | Agregação das referências de redação por dispositivo |
| `ids_depreciados` | `LeiNode.idsDepreciados` | `BlockIdDepreciado[]` | Aliases permanentes de Block IDs publicados |
| `fonte_secundaria` | `LeiNode.fontesSecundarias` | `string[]` | Fontes opcionais de checagem cruzada |

O frontmatter é a serialização "de leitura humana" desses campos; o Supabase é a serialização "de consulta estruturada". Ambos derivam da mesma fonte: a NormaAST gerada pelo Lex Editor. `publicationStatus` permanece na NormaAST para controlar o fluxo editorial, mas não é serializado no frontmatter; `deviceStatus` é materializado no corpo conforme `MARKDOWN_SPEC.md`. `dataVerificacaoIntegridade`, `avisosAtualizacao` e `notasEditoriais` alimentam callouts do cabeçalho e as colunas privadas correspondentes de `versoes_lei`; não criam novas chaves de frontmatter.

---

## Schema Postgres/Supabase

```sql
-- Catálogo de leis (uma linha por lei, independente de versão)
CREATE TABLE leis (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sigla           text NOT NULL UNIQUE,           -- "CP", "CPP", "CF88"
    titulo          text NOT NULL,
    tipo            text NOT NULL,                  -- "lei ordinária", "decreto-lei", ...
    numero          text NOT NULL,
    ano             integer NOT NULL,
    ramo            text NOT NULL,
    fonte_url       text NOT NULL,
    data_publicacao date NOT NULL,
    versao_publicada_id uuid,                       -- ponteiro explícito para a versão servida pelo SaaS
    legal_status        text NOT NULL DEFAULT 'vigente' -- vigente | revogada | alterada | suspensa | sem_eficacia | desconhecida (ver ADR-005-status-fields.md)
        CHECK (legal_status IN ('vigente', 'revogada', 'alterada', 'suspensa', 'sem_eficacia', 'desconhecida')),
    publication_status  text NOT NULL DEFAULT 'draft'   -- draft | review | approved | published | archived | outdated
        CHECK (publication_status IN ('draft', 'review', 'approved', 'published', 'archived', 'outdated')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Cada publicação concluída de uma lei gera uma nova versão
CREATE TABLE versoes_lei (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lei_id                      uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    numero_publicacao           integer NOT NULL,          -- sequência monotônica por lei
    versao_vinculex             text NOT NULL,             -- SemVer sem prefixo "v"
    tipo_publicacao             text NOT NULL
        CHECK (tipo_publicacao IN (
            'initial','legislative_update','editorial_correction','rollback'
        )),
    restaura_versao_id          uuid,
    git_commit_sha              text NOT NULL,             -- release commit no branch canônico
    conteudo_sha256             text NOT NULL,             -- manifesto canônico da publicação
    data_atualizacao_legal      date NOT NULL,              -- data do fato jurídico (nova redação etc.)
    data_formatacao_vinculex    date NOT NULL,
    total_artigos               integer NOT NULL CHECK (total_artigos >= 0),
    tags                        text[] NOT NULL DEFAULT '{}',
    revogada_por                text,
    redacoes_dadas_por          jsonb NOT NULL DEFAULT '[]'::jsonb,
    ids_depreciados             jsonb NOT NULL DEFAULT '[]'::jsonb,
    fontes_secundarias          text[] NOT NULL DEFAULT '{}',
    data_verificacao_integridade date NOT NULL,
    avisos_atualizacao          text[] NOT NULL DEFAULT '{}',
    notas_editoriais            text[] NOT NULL DEFAULT '{}',
    changelog                   text NOT NULL,              -- entrada pública de UPDATE.md, sem identidade privada
    mudancas                    jsonb NOT NULL,              -- arrays de IDs; renumbered usa {from,to}
    aprovado_por                uuid NOT NULL REFERENCES auth.users(id),
    publicado_em                timestamptz NOT NULL DEFAULT now(),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CHECK (conteudo_sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (git_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
    CHECK (versao_vinculex ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
    CHECK (jsonb_typeof(mudancas) = 'object'),
    CHECK (jsonb_typeof(redacoes_dadas_por) = 'array'),
    CHECK (jsonb_typeof(ids_depreciados) = 'array'),
    CHECK (
        (tipo_publicacao = 'rollback' AND restaura_versao_id IS NOT NULL)
        OR (tipo_publicacao <> 'rollback' AND restaura_versao_id IS NULL)
    ),
    UNIQUE (lei_id, numero_publicacao),
    UNIQUE (lei_id, versao_vinculex),
    UNIQUE (lei_id, git_commit_sha),
    UNIQUE (id, lei_id),
    FOREIGN KEY (restaura_versao_id, lei_id)
        REFERENCES versoes_lei(id, lei_id)
);

ALTER TABLE leis
    ADD CONSTRAINT leis_versao_publicada_fk
    FOREIGN KEY (versao_publicada_id, id)
    REFERENCES versoes_lei(id, lei_id);

ALTER TABLE leis
    ADD CONSTRAINT leis_publicacao_coerente
    CHECK (
        publication_status <> 'published'
        OR versao_publicada_id IS NOT NULL
    );

-- Artefatos oficiais preservados separadamente para cada versão (ADR-009).
CREATE TABLE artefatos_fonte (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    versao_lei_id     uuid NOT NULL REFERENCES versoes_lei(id) ON DELETE CASCADE,
    source_type       text NOT NULL
        CHECK (source_type IN ('planalto_html','lexml_xml','markdown','local_file')),
    source_role       text NOT NULL
        CHECK (source_role IN ('primary_current','historical_auxiliary','cross_check')),
    source_variant    text NOT NULL
        CHECK (source_variant IN ('compiled','annotated','other')),
    source_url        text,
    final_url         text,
    artifact_sha256   text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
    artifact_uri      text NOT NULL,
    captured_at       timestamptz NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),

    UNIQUE (versao_lei_id, source_role, artifact_sha256)
);

CREATE UNIQUE INDEX artefatos_fonte_uma_primaria_por_versao
    ON artefatos_fonte (versao_lei_id)
    WHERE source_role = 'primary_current';

-- Registro histórico de Block IDs, preservando estabilidade entre versões
CREATE TABLE block_ids (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lei_id              uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    block_id            text NOT NULL, -- valor canônico sem "^"; namespace histórico append-only
    primeira_versao_id  uuid NOT NULL,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (lei_id, block_id),
    FOREIGN KEY (primeira_versao_id, lei_id)
        REFERENCES versoes_lei(id, lei_id)
);

-- Redirecionamentos permanentes para IDs publicados que precisaram ser
-- corrigidos ou que representam uma posição explicitamente renumerada.
-- Origem e destino permanecem reservados em block_ids para sempre.
CREATE TABLE block_id_redirects (
    lei_id                    uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    origem_block_id           text NOT NULL,
    destino_block_id          text NOT NULL,
    criado_em_versao_id       uuid NOT NULL,
    motivo                    text NOT NULL,
    criado_em                 timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lei_id, origem_block_id),
    CHECK (origem_block_id <> destino_block_id),
    FOREIGN KEY (lei_id, origem_block_id)
        REFERENCES block_ids(lei_id, block_id),
    FOREIGN KEY (lei_id, destino_block_id)
        REFERENCES block_ids(lei_id, block_id),
    FOREIGN KEY (criado_em_versao_id, lei_id)
        REFERENCES versoes_lei(id, lei_id)
);

-- Snapshot completo dos nós de uma IdentifiedNormaAST para cada versão.
-- O nome histórico "dispositivos" inclui também divisões estruturais.
CREATE TABLE dispositivos (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    versao_lei_id               uuid NOT NULL,
    lei_id                      uuid NOT NULL,
    parent_id                   uuid,
    tipo                        text NOT NULL
        CHECK (tipo IN (
            'livro','titulo','capitulo','secao','subsecao',
            'artigo','paragrafo','inciso','alinea','item','pena','anexo','tabela'
        )),
    block_id                    text, -- NULL para divisões sem âncora
    numero                      text,
    titulo                      text, -- divisões, anexo e caption editorial
    texto                       text, -- caput/texto vigente; NULL em divisão/tabela
    conteudo_estruturado        jsonb, -- {headers, rows} para tabela
    ordem                       integer NOT NULL,
    device_status               text NOT NULL DEFAULT 'active'
        CHECK (device_status IN (
            'active','revoked','vetoed','included',
            'amended','renumbered','suspended','unknown'
        )),
    nota_status                 text,
    preservar_texto_revogado    boolean,
    redacao_atual_dada_por      text,
    redacoes_anteriores         jsonb NOT NULL DEFAULT '[]'::jsonb,
    renumerado_para_block_id    text,
    source_ref                  jsonb NOT NULL,
    supporting_source_refs      jsonb NOT NULL DEFAULT '[]'::jsonb,
    parse_evidence              jsonb NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now(),

    UNIQUE (id, versao_lei_id),
    UNIQUE (versao_lei_id, block_id),

    FOREIGN KEY (versao_lei_id, lei_id)
        REFERENCES versoes_lei(id, lei_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id, versao_lei_id)
        REFERENCES dispositivos(id, versao_lei_id) ON DELETE CASCADE,
    FOREIGN KEY (lei_id, block_id)
        REFERENCES block_ids(lei_id, block_id),
    FOREIGN KEY (lei_id, renumerado_para_block_id)
        REFERENCES block_ids(lei_id, block_id),

    CHECK (
        tipo IN ('livro','titulo','capitulo','secao','subsecao')
        OR block_id IS NOT NULL
    ),
    CHECK (
        device_status <> 'revoked'
        OR preservar_texto_revogado IS NOT NULL
    ),
    CHECK (jsonb_typeof(redacoes_anteriores) = 'array'),
    CHECK (jsonb_typeof(source_ref) = 'object'),
    CHECK (jsonb_typeof(supporting_source_refs) = 'array'),
    CHECK (jsonb_typeof(parse_evidence) = 'object'),
    CHECK (
        tipo <> 'tabela'
        OR (
            conteudo_estruturado IS NOT NULL
            AND jsonb_typeof(conteudo_estruturado) = 'object'
        )
    )
);

-- UNIQUE simples não trata parent_id NULL como um mesmo grupo. Os dois
-- índices cobrem separadamente irmãos com pai e nós raiz de cada versão.
CREATE UNIQUE INDEX dispositivos_ordem_irmaos_unique
    ON dispositivos (versao_lei_id, parent_id, ordem)
    WHERE parent_id IS NOT NULL;

CREATE UNIQUE INDEX dispositivos_ordem_raiz_unique
    ON dispositivos (versao_lei_id, ordem)
    WHERE parent_id IS NULL;

-- Fila de propostas geradas pelo worker de atualização legislativa
-- update_review_status é um 4º enum formalizado em ADR-005-status-fields.md,
-- deliberadamente separado de legal_status/publication_status/device_status:
-- descreve o andamento da revisão da pendência, não o estado jurídico da
-- lei, o fluxo editorial da publicação nem o estado de um dispositivo.
CREATE TABLE updates_legislativos (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lei_id                uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    hash_fonte_anterior   text NOT NULL,
    hash_fonte_atual      text NOT NULL,
    diff_resumo           text,               -- diff textual ou estrutural resumido
    update_review_status  text NOT NULL DEFAULT 'pending'
        CHECK (update_review_status IN ('pending','approved','rejected','superseded','error')),
    versao_publicada_id   uuid,
    detectado_em          timestamptz NOT NULL DEFAULT now(),
    approved_by           uuid REFERENCES auth.users(id),
    approved_at           timestamptz,
    rejection_reason      text,
    error_message         text,
    FOREIGN KEY (versao_publicada_id, lei_id)
        REFERENCES versoes_lei(id, lei_id),
    CHECK (
        update_review_status <> 'approved'
        OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
    ),
    CHECK (
        update_review_status <> 'rejected'
        OR rejection_reason IS NOT NULL
    )
);

-- Registro de cada publicação lógica. A chave de idempotência acompanha todas
-- as tentativas; retry nunca cria outro commit nem outra versoes_lei.
CREATE TABLE publicacoes (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lei_id                      uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    versao_lei_id               uuid,
    idempotency_key             uuid NOT NULL,
    versao_vinculex             text NOT NULL,
    publication_attempt_status  text NOT NULL
        CHECK (publication_attempt_status IN (
            'prepared','committed_local','pushed','syncing','published','failed'
        )),
    git_commit_sha              text,
    conteudo_sha256             text NOT NULL,
    publicado_por               uuid REFERENCES auth.users(id),
    canal                       text NOT NULL DEFAULT 'supabase'
        CHECK (canal IN ('supabase','github-publico','obsidian-publish')),
    tentativas_sync              integer NOT NULL DEFAULT 0,
    ultimo_erro                  text,
    preparado_em                 timestamptz NOT NULL DEFAULT now(),
    publicado_em                 timestamptz,
    atualizado_em                timestamptz NOT NULL DEFAULT now(),
    CHECK (conteudo_sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (
        git_commit_sha IS NULL
        OR git_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
    ),
    CHECK (versao_vinculex ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
    CHECK (
        publication_attempt_status <> 'published'
        OR (
            versao_lei_id IS NOT NULL
            AND git_commit_sha IS NOT NULL
            AND publicado_por IS NOT NULL
            AND publicado_em IS NOT NULL
        )
    ),
    UNIQUE (lei_id, idempotency_key),
    UNIQUE (lei_id, versao_vinculex),
    UNIQUE (lei_id, git_commit_sha),
    FOREIGN KEY (versao_lei_id, lei_id)
        REFERENCES versoes_lei(id, lei_id)
);
```

### Contrato de versão e publicação

Uma publicação lógica é identificada por `idempotency_key` e por um manifesto
imutável contendo, no mínimo: lei, versão SemVer alvo, tipo de publicação,
commit-base esperado, hashes do Markdown, do `UPDATE.md`, da
`IdentifiedNormaAST`, além de função, variante, URL e hash de todos os snapshots
de origem e do editor que aprovou. O manifesto é persistido no diário local
durável do Lex Editor antes do commit e espelhado em `publicacoes` assim que o
Supabase estiver acessível.

Regras normativas:

1. A primeira publicação usa `1.0.0`. O valor persistido nunca leva prefixo
   `v`; esse prefixo pode aparecer apenas na apresentação ou mensagem de commit.
2. `MAJOR` muda quando o contrato de representação publicado exige migração de
   consumidores; `MINOR`, quando muda a projeção normativa (texto, hierarquia,
   dispositivo, vigência ou Block ID novo); `PATCH`, quando muda apenas
   metadado, formatação ou evidência editorial sem alterar a projeção normativa.
3. Versões nunca são reutilizadas, reduzidas ou editadas. Além do SemVer,
   `numero_publicacao` cresce em uma unidade a cada publicação bem-sucedida e é
   a ordenação cronológica autoritativa.
4. Existe um único changelog canônico por lei:
   `leis/<diretorio-da-lei>/UPDATE.md`. Ele recebe uma entrada inclusive na
   publicação inicial, em ordem decrescente de `numero_publicacao`, e integra o
   mesmo commit do Markdown e do manifesto. `CHANGELOG.md` não faz parte do
   contrato.
   O manifesto ocupa
   `leis/<diretorio-da-lei>/.vinculex/releases/{numero_publicacao com 6
   dígitos}-{versao_vinculex}.json` e é append-only.
5. A estação envia o release commit apenas ao branch candidato
   `releases/{publicationId}`. O mesmo SHA só se torna canônico após validação e
   promoção pelo Serviço de Publicação ao branch protegido. Um commit apenas
   local está em `committed_local`; candidato remoto está em `pushed`; nenhum
   dos dois está “publicado”.
6. Somente o Serviço de Publicação lê o release commit pelo SHA, verifica
   aprovação/manifesto e grava em uma única transação: `versoes_lei`, exatamente
   uma fonte `primary_current`, os demais `artefatos_fonte`, o snapshot completo
   de `dispositivos`, novos
   `block_ids`/redirecionamentos e, por último, o ponteiro
   `leis.versao_publicada_id` e, na publicação inicial,
   `publication_status = 'published'`. Atualização parcial apenas dos
   dispositivos alterados é proibida.
7. A publicação só está concluída quando essa transação termina e
   `publication_attempt_status = 'published'`. Retry reutiliza a mesma chave,
   versão, manifesto e SHA; nunca cria outro commit ou outra versão.
   O caminho normal é `prepared → committed_local → pushed → syncing →
   published`. `failed` registra uma falha retomável; a retomada volta ao último
   estágio seguro comprovado pelos artefatos persistidos. `published` é
   terminal.
8. A decisão editorial (`update_review_status = 'approved'`) é registrada antes
   da publicação; o vínculo `updates_legislativos.versao_publicada_id` e o hash
   de referência do worker só avançam após o sucesso da transação.
9. Rollback é uma publicação para frente: restaura o snapshot de uma
   `versoes_lei` anterior em um novo commit, nova versão e novo
   `numero_publicacao`, registra `tipo_publicacao = 'rollback'` e
   `restaura_versao_id`. O incremento SemVer decorre do diff contra a versão
   corrente — normalmente `MINOR` se o conteúdo normativo mudar, `PATCH` se
   apenas metadados/formatação forem restaurados. O histórico Git e as linhas
   anteriores do banco nunca são reescritos.
10. A publicação usa concorrência otimista. Antes do push candidato, antes da
    promoção e novamente antes da transação, compara o commit-base e a
    `versao_publicada_id` esperados. Se
    outra publicação venceu a corrida, a tentativa é bloqueada; SemVer,
    `numero_publicacao`, diff, `UPDATE.md` e manifesto são recalculados e
    submetidos a nova confirmação humana.

### Regras de projeção NormaAST ↔ Postgres

1. O sync aceita apenas uma `IdentifiedNormaAST` validada.
2. `LeiNode` é projetado em `leis` + `versoes_lei`; seus descendentes viram
   uma linha em `dispositivos`, preservando `parent_id` e `ordem`.
   Metadados opcionais do nó raiz (`tags`, revogação, redações, IDs
   depreciados, fontes secundárias, avisos e notas editoriais) pertencem à
   versão e são persistidos nas colunas correspondentes de `versoes_lei`; não entram
   automaticamente na projeção pública.
3. Divisões estruturais normalmente persistem `block_id = NULL`. Artigo,
   parágrafo, inciso, alínea, item, pena, anexo e tabela exigem ID registrado
   previamente em `block_ids`.
4. `ArtigoNode.caput` é persistido em `texto`. Os demais nós textuais usam o
   mesmo campo. `TabelaNode.headers/rows` usa `conteudo_estruturado`.
5. `redacoesAnteriores` é persistido integralmente, na mesma ordem, em
   `redacoes_anteriores`; não é reconstruído por parsing do Markdown.
6. `renumeradoPara` exige o redirecionamento correspondente em
   `block_id_redirects`.
7. `sourceRef`, `supportingSourceRefs` e `parseEvidence` são persistidos sem
   remoção de campos. O `sourceArtifactSha256` de cada referência deve coincidir
   com um registro de `artefatos_fonte` da versão, com função e variante
   coerentes com a ADR-009.
8. O teste de round-trip reconstrói a `IdentifiedNormaAST` a partir do banco e
   exige igualdade semântica com a árvore de entrada, ignorando apenas UUIDs
   internos gerados na persistência. Perda de texto, história, hierarquia,
   evidência ou conteúdo tabular bloqueia o sync.
9. `versoes_lei.mudancas` deriva do mesmo diff aprovado que produz
   `UPDATE.md`. O objeto contém exatamente os arrays `included`, `amended`,
   `revoked` e `renumbered`, com Block IDs únicos e registrados; para
   renumeração, cada item contém origem e destino. O publicador valida a forma
   antes da transação, e clientes nunca extraem links por parsing do texto de
   `changelog`.

| NormaAST (TypeScript) | Postgres | Observação |
|---|---|---|
| `blockId` | `block_id` | Sempre sem `^` |
| `deviceStatus` | `device_status` | Mesmo enum |
| `notaStatus` | `nota_status` | Texto explicativo |
| `preservarTextoRevogado` | `preservar_texto_revogado` | Obrigatório para `revoked` |
| `redacaoAtualDadaPor` | `redacao_atual_dada_por` | Redação vigente |
| `redacoesAnteriores` | `redacoes_anteriores` | JSON ordenado |
| `renumeradoPara` | `renumerado_para_block_id` | Exige alias permanente |
| `sourceRef` | `source_ref` | JSON preservado integralmente |
| `supportingSourceRefs` | `supporting_source_refs` | Evidências complementares ordenadas |
| `parseEvidence` | `parse_evidence` | JSON preservado integralmente |
| `children` + `ordem` | `parent_id` + `ordem` | Materializa a árvore |
| `TabelaNode.headers/rows` | `conteudo_estruturado` | JSON retangular |

---

## Relacionamentos entre tabelas

```mermaid
erDiagram
    LEIS ||--o{ VERSOES_LEI : possui
    LEIS ||--o| VERSOES_LEI : "versao_publicada_id"
    VERSOES_LEI ||--|{ ARTEFATOS_FONTE : preserva
    VERSOES_LEI ||--o{ DISPOSITIVOS : contem
    VERSOES_LEI ||--o{ FAVORITOS : "snapshot ao favoritar"
    VERSOES_LEI ||--o{ NOTAS : "snapshot ao criar"
    DISPOSITIVOS ||--o{ DISPOSITIVOS : "parent_id (hierarquia)"
    LEIS ||--o{ BLOCK_IDS : registra
    VERSOES_LEI ||--o| BLOCK_IDS : "primeira_versao_id"
    BLOCK_IDS ||--o| BLOCK_ID_REDIRECTS : "origem"
    BLOCK_IDS ||--o{ BLOCK_ID_REDIRECTS : "destino"
    LEIS ||--o{ UPDATES_LEGISLATIVOS : gera
    VERSOES_LEI ||--o| UPDATES_LEGISLATIVOS : "publica a pendência"
    LEIS ||--o{ PUBLICACOES : "tenta publicar"
    VERSOES_LEI ||--o| PUBLICACOES : "resultado da publicação"

    AUTH_USERS ||--o| USUARIOS_PERFIL : "estende (1:1)"
    AUTH_USERS ||--o{ FAVORITOS : salva
    AUTH_USERS ||--o{ COLECOES : organiza
    AUTH_USERS ||--o{ NOTAS : escreve
    AUTH_USERS ||--o{ MARCACOES : marca
    AUTH_USERS ||--o{ EVENTOS_LEITURA : registra
    AUTH_USERS ||--o{ PROGRESSO_LEITURA : acumula
    AUTH_USERS ||--o{ TRILHAS_ESTUDO : cria
    AUTH_USERS ||--o{ TRILHAS_USUARIO : segue
    AUTH_USERS ||--o{ NOTIFICACOES : recebe
    AUTH_USERS ||--o{ AUDITORIA_ADMIN : executa
    AUTH_USERS ||--o{ ASSINATURAS : assina
    ASSINATURAS ||--o{ EVENTOS_GATEWAY_PAGAMENTO : recebe
    LEIS ||--o{ FAVORITOS : "pode ser favoritada"
    LEIS ||--o{ NOTAS : "ancora via lei_id"
    LEIS ||--o{ MARCACOES : "ancora via lei_id"
    LEIS ||--o{ EVENTOS_LEITURA : "ancora via lei_id"
    LEIS ||--o{ PROGRESSO_LEITURA : "acumula progresso"
    LEIS ||--o{ TRILHA_ITENS : "pode ser item de trilha"
    BLOCK_IDS ||--o{ FAVORITOS : "ancora block_id (dispositivo)"
    BLOCK_IDS ||--o{ NOTAS : "ancora block_id"
    BLOCK_IDS ||--o{ MARCACOES : "ancora block_id"
    BLOCK_IDS ||--o{ EVENTOS_LEITURA : "ancora block_id"
    BLOCK_IDS ||--o{ TRILHA_ITENS : "ancora block_id (opcional)"
    COLECOES ||--o{ FAVORITOS_COLECAO : agrupa
    FAVORITOS ||--o{ FAVORITOS_COLECAO : pertence
    TRILHAS_ESTUDO ||--o{ TRILHA_ITENS : contem
    TRILHAS_ESTUDO ||--o{ TRILHAS_USUARIO : adotada
    VERSOES_LEI ||--o{ NOTIFICACOES : notifica

    LEIS {
        uuid id PK
        text sigla
        text titulo
        text legal_status
        text publication_status
        uuid versao_publicada_id FK
    }
    VERSOES_LEI {
        uuid id PK
        uuid lei_id FK
        integer numero_publicacao
        text versao_vinculex
        text tipo_publicacao
        uuid restaura_versao_id FK
        text git_commit_sha
        text conteudo_sha256
        jsonb mudancas
    }
    ARTEFATOS_FONTE {
        uuid id PK
        uuid versao_lei_id FK
        text source_role
        text source_variant
        text artifact_sha256
        text artifact_uri
    }
    DISPOSITIVOS {
        uuid id PK
        uuid versao_lei_id FK
        uuid lei_id FK
        text block_id
        uuid parent_id FK
        text tipo
        text device_status
        jsonb redacoes_anteriores
        jsonb source_ref
        jsonb supporting_source_refs
        jsonb parse_evidence
    }
    BLOCK_IDS {
        uuid id PK
        uuid lei_id FK
        text block_id
        uuid primeira_versao_id FK
    }
    BLOCK_ID_REDIRECTS {
        uuid lei_id PK_FK
        text origem_block_id PK_FK
        text destino_block_id FK
        uuid criado_em_versao_id FK
    }
    UPDATES_LEGISLATIVOS {
        uuid id PK
        uuid lei_id FK
        text update_review_status
        uuid versao_publicada_id FK
    }
    PUBLICACOES {
        uuid id PK
        uuid lei_id FK
        uuid versao_lei_id FK
        uuid idempotency_key
        text versao_vinculex
        text publication_attempt_status
        text git_commit_sha
        text conteudo_sha256
        text canal
    }
    AUTH_USERS {
        uuid id PK
    }
    USUARIOS_PERFIL {
        uuid user_id PK_FK
        text foco_concurso
        text papel
        text account_status
    }
    FAVORITOS {
        uuid id PK
        uuid user_id FK
        uuid lei_id FK
        text block_id FK
        uuid versao_lei_id_criacao FK
        text tipo_favorito
    }
    COLECOES {
        uuid id PK
        uuid user_id FK
        text nome
    }
    FAVORITOS_COLECAO {
        uuid favorito_id PK_FK
        uuid colecao_id PK_FK
    }
    NOTAS {
        uuid id PK
        uuid user_id FK
        uuid lei_id FK
        text block_id FK
        uuid versao_lei_id_criacao FK
        text conteudo
    }
    MARCACOES {
        uuid id PK
        uuid user_id FK
        uuid lei_id FK
        text block_id FK
        text tipo_marcacao
    }
    EVENTOS_LEITURA {
        uuid id PK
        uuid user_id FK
        uuid lei_id FK
        text block_id FK
        timestamptz lido_em
    }
    PROGRESSO_LEITURA {
        uuid id PK
        uuid user_id FK
        uuid lei_id FK
        numeric percentual_concluido
        integer sequencia_dias_estudo
    }
    TRILHAS_ESTUDO {
        uuid id PK
        uuid criado_por FK
        boolean publica
        text foco_concurso
    }
    TRILHA_ITENS {
        uuid id PK
        uuid trilha_id FK
        uuid lei_id FK
        text block_id FK
        integer ordem
    }
    TRILHAS_USUARIO {
        uuid user_id PK_FK
        uuid trilha_id PK_FK
        boolean ativa
        timestamptz iniciado_em
    }
    NOTIFICACOES {
        uuid id PK
        uuid user_id FK
        uuid lei_id FK
        uuid versao_lei_id FK
        text tipo_notificacao
        timestamptz lida_em
    }
    AUDITORIA_ADMIN {
        uuid id PK
        uuid ator_user_id FK
        uuid alvo_user_id FK
        text acao
        text justificativa
        timestamptz criado_em
    }
    ASSINATURAS {
        uuid id PK
        uuid user_id FK
        text plano
        text periodicidade
        text meio_pagamento
        text subscription_status
        text provedor_pagamento
    }
    EVENTOS_GATEWAY_PAGAMENTO {
        uuid id PK
        uuid assinatura_id FK
        text provedor
        text evento_id
        text tipo_evento
        text payment_event_processing_status
    }
```

---

## Schema do Vinculex SaaS

> Tabelas do produto SaaS (biblioteca pessoal, notas, favoritos, progresso,
> trilhas de estudo e assinatura), que consomem o conteúdo normativo publicado
> pelo Lex Editor mas nunca o alteram. Nenhuma tabela desta seção usa um
> campo `status` genérico — ver `./ADR-005-status-fields.md`. Toda referência
> a um dispositivo específico usa `block_id` (texto), nunca `dispositivos.id`,
> porque o Block ID é a única chave estável entre versões de uma lei (ver
> `./ADR-001-block-ids-imutaveis.md`); quando a tabela também guarda `lei_id`,
> a integridade referencial de `block_id` é garantida por uma FK composta
> contra `block_ids(lei_id, block_id)` — não por uma FK contra `dispositivos`,
> que é recriada a cada nova versão publicada. O valor é sempre armazenado sem
> `^`. Quando um ID não existir na versão pública atual, a camada oficial de leitura
> consulta `block_id_redirects` antes de responder como inexistente.

### 1. Perfil de usuário

Extensão 1:1 de `auth.users` (gerenciado pelo Supabase Auth) com dados de
domínio do Vinculex — nunca credenciais. `foco_concurso` é texto livre e não
um enum porque a lista de concursos-alvo (CFO/PMMG, CFS, CFO, Delegado, OAB
etc.) é decisão de conteúdo/marketing, não um ciclo de vida de entidade —
não se enquadra na ADR-005.

```sql
CREATE TABLE usuarios_perfil (
    user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nome_exibicao   text,
    foco_concurso   text,                               -- ex.: "CFO/PMMG", "CFS", "CFO", "Delegado", "OAB"
    papel           text NOT NULL DEFAULT 'usuario'
        CHECK (papel IN ('usuario', 'curador', 'administrador')),
    account_status  text NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'suspended')),
    preferencias    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- tema, notificações etc. — jsonb evita migração a cada nova preferência
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now()
);
```

### 2. Favoritos e coleções

Um favorito é "lei inteira" **ou** "dispositivo específico" (nunca os dois),
controlado por `tipo_favorito` e pela nulidade de `block_id`. A FK composta
`(lei_id, block_id) REFERENCES block_ids(lei_id, block_id)` usa o
comportamento padrão do Postgres (`MATCH SIMPLE`): quando `block_id` é `NULL`
(favorito de lei inteira), a checagem de integridade referencial é
simplesmente ignorada, sem necessidade de duas tabelas separadas.

```sql
CREATE TABLE favoritos (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lei_id          uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    block_id        text,                       -- NULL quando tipo_favorito = 'lei'
    versao_lei_id_criacao uuid NOT NULL,        -- versão pública no momento do favorito
    tipo_favorito   text NOT NULL               -- lei | dispositivo
        CHECK (tipo_favorito IN ('lei', 'dispositivo')),
    criado_em       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT favoritos_block_id_coerente CHECK (
        (tipo_favorito = 'lei' AND block_id IS NULL) OR
        (tipo_favorito = 'dispositivo' AND block_id IS NOT NULL)
    ),
    FOREIGN KEY (lei_id, block_id) REFERENCES block_ids(lei_id, block_id),
    FOREIGN KEY (versao_lei_id_criacao, lei_id)
        REFERENCES versoes_lei(id, lei_id)
);

-- Índices parciais em vez de UNIQUE simples: duas linhas com block_id NULL
-- não colidem em uma UNIQUE constraint comum do Postgres, então a
-- deduplicação de favoritos "de lei inteira" precisa de um índice à parte.
CREATE UNIQUE INDEX favoritos_lei_unica
    ON favoritos (user_id, lei_id) WHERE tipo_favorito = 'lei';
CREATE UNIQUE INDEX favoritos_dispositivo_unico
    ON favoritos (user_id, block_id) WHERE tipo_favorito = 'dispositivo';

-- Coleções nomeadas pelo usuário para agrupar favoritos, ex.: "Revisão final CFO"
CREATE TABLE colecoes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nome            text NOT NULL,
    descricao       text,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, nome)
);

-- N:N — um favorito pode estar em mais de uma coleção (ex.: o mesmo artigo
-- em "Revisão final CFO" e em "Artigos que sempre erro"). Tabela de
-- associação pura, sem user_id próprio: a política de RLS valida a
-- propriedade via EXISTS contra favoritos/colecoes (ver seção RLS).
CREATE TABLE favoritos_colecao (
    favorito_id     uuid NOT NULL REFERENCES favoritos(id) ON DELETE CASCADE,
    colecao_id      uuid NOT NULL REFERENCES colecoes(id) ON DELETE CASCADE,
    adicionado_em   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (favorito_id, colecao_id)
);
```

### 3. Notas

Nota pessoal em Markdown, ancorada em `block_id`. Um usuário pode ter mais de
uma nota no mesmo `block_id` (anotações feitas em momentos diferentes do
estudo), por isso não há `UNIQUE (user_id, block_id)`.

```sql
CREATE TABLE notas (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lei_id          uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    block_id        text NOT NULL,
    versao_lei_id_criacao uuid NOT NULL, -- versão cujo texto estava visível ao criar
    titulo          text,               -- rótulo curto opcional, definido pelo usuário
    conteudo        text NOT NULL,      -- markdown livre
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (lei_id, block_id) REFERENCES block_ids(lei_id, block_id),
    FOREIGN KEY (versao_lei_id_criacao, lei_id)
        REFERENCES versoes_lei(id, lei_id)
);
```

### 4. Marcações rápidas

Marcação é diferente de favorito: favorito é um ato deliberado de curadoria
(opcionalmente organizado em coleções); marcação é uma tag rápida sobre um
dispositivo, sem a cerimônia de "guardar para depois". `tipo_marcacao` é um
enum fechado do produto — e não um campo `status` genérico (ver
`./ADR-005-status-fields.md`): não descreve um ciclo de vida com transições,
é uma classificação estática escolhida pelo usuário no momento da marcação.

```sql
CREATE TABLE marcacoes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lei_id          uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    block_id        text NOT NULL,
    tipo_marcacao   text NOT NULL          -- importante | revisar | duvida | cobranca_frequente
        CHECK (tipo_marcacao IN ('importante', 'revisar', 'duvida', 'cobranca_frequente')),
    criado_em       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (lei_id, block_id) REFERENCES block_ids(lei_id, block_id),
    UNIQUE (user_id, block_id, tipo_marcacao) -- evita duplicar a mesma tag no mesmo dispositivo
);
```

### 5. Progresso de leitura

Duas tabelas, não uma: um log de eventos (`eventos_leitura`, grão fino, por
`block_id`) e um estado agregado (`progresso_leitura`, grão grosso, por lei)
mantido a partir do log.

Por que duas tabelas em vez de só uma agregada: o log preserva histórico
auditável e granular — quais dispositivos exatos já foram lidos e quando —
necessário para calcular `percentual_concluido` corretamente e para uma
futura funcionalidade de "retomar de onde parei". Um único registro agregado
por usuário/lei jamais permitiria recalcular a sequência de dias de estudo
(streak) nem saber quais `block_id`s específicos já foram lidos sem
reprocessar tudo a cada leitura.

Por que a agregação é por lei (não por `block_id`): o produto expõe
progresso no nível "quanto do Código Penal eu já li", não "há quanto tempo
li o art. 121" — granularidade por `block_id` no agregado geraria uma linha
por dispositivo por usuário sem necessidade (o dado granular já existe em
`eventos_leitura`), e tornaria o dashboard de progresso uma agregação cara em
tempo de consulta em vez de leitura direta de uma linha.

```sql
-- Log de eventos de leitura (append-only, nunca atualizado/deletado pelo usuário)
CREATE TABLE eventos_leitura (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lei_id          uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    block_id        text NOT NULL,
    lido_em         timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (lei_id, block_id) REFERENCES block_ids(lei_id, block_id)
);
CREATE INDEX eventos_leitura_user_lei_idx ON eventos_leitura (user_id, lei_id, lido_em);

-- Estado agregado por usuário/lei, recalculado por trigger (AFTER INSERT em
-- eventos_leitura) ou job assíncrono — não é escrito diretamente pelo
-- usuário (ver RLS).
CREATE TABLE progresso_leitura (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lei_id                  uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    dispositivos_lidos      integer NOT NULL DEFAULT 0,        -- artigos ativos distintos já lidos
    percentual_concluido    numeric(5,2) NOT NULL DEFAULT 0,   -- lidos / artigos active da versão pública
    ultima_leitura_em       timestamptz,
    sequencia_dias_estudo   integer NOT NULL DEFAULT 0,        -- streak atual, em dias consecutivos com leitura
    maior_sequencia_dias    integer NOT NULL DEFAULT 0,        -- recorde histórico da streak
    atualizado_em           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, lei_id)
);
```

### 6. Trilhas de estudo

Trilha pública (`publica = true`): criada pela equipe editorial, visível a
todos — ex.: "Direito Penal para CFO/PMMG". Trilha privada
(`publica = false`): criada pelo próprio usuário para organizar seu percurso
de estudo, visível apenas a quem a criou. Cada item aponta para uma lei
inteira **ou** um dispositivo específico dentro dela — mesma lógica de
`favoritos`: `lei_id` sempre presente, `block_id` opcional, integridade via
`block_ids`.

```sql
CREATE TABLE trilhas_estudo (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    criado_por      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    titulo          text NOT NULL,
    descricao       text,
    publica         boolean NOT NULL DEFAULT false,
    foco_concurso   text,           -- ex.: "CFO/PMMG" — mesma convenção de usuarios_perfil.foco_concurso
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trilha_itens (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trilha_id           uuid NOT NULL REFERENCES trilhas_estudo(id) ON DELETE CASCADE,
    lei_id              uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    block_id            text,                -- NULL quando o item aponta para a lei inteira
    ordem               integer NOT NULL,    -- posição do item dentro da trilha
    titulo_customizado  text,                -- rótulo opcional definido por quem monta a trilha, ex.: "Comece aqui"
    FOREIGN KEY (lei_id, block_id) REFERENCES block_ids(lei_id, block_id),
    UNIQUE (trilha_id, ordem)
);
```

### 7. Adoção de trilhas

Uma trilha pública só se torna parte do percurso de um usuário quando existe
uma linha em `trilhas_usuario`. A mesma relação define qual trilha está ativa;
há no máximo uma por usuário. O progresso é derivado de `eventos_leitura`
cruzado com `trilha_itens`, sem duplicar contadores.

```sql
CREATE TABLE trilhas_usuario (
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    trilha_id       uuid NOT NULL REFERENCES trilhas_estudo(id) ON DELETE CASCADE,
    ativa           boolean NOT NULL DEFAULT false,
    iniciado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, trilha_id)
);

CREATE UNIQUE INDEX trilha_ativa_por_usuario
    ON trilhas_usuario (user_id)
    WHERE ativa;
```

### 8. Notificações

Notificações legislativas nascem somente após a troca bem-sucedida de
`leis.versao_publicada_id`. Uma função privada calcula os destinatários pela
união de: favorito da lei, progresso registrado ou trilha ativa que contenha
a lei, intersectada com a regra vigente de entitlement do produto. A
restrição única torna o fan-out idempotente quando um usuário atende
a mais de um critério ou o job é reexecutado.

```sql
CREATE TABLE notificacoes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lei_id              uuid NOT NULL REFERENCES leis(id) ON DELETE CASCADE,
    versao_lei_id       uuid NOT NULL,
    tipo_notificacao    text NOT NULL
        CHECK (tipo_notificacao IN ('atualizacao_legislativa')),
    lida_em             timestamptz,
    criado_em           timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (versao_lei_id, lei_id)
        REFERENCES versoes_lei(id, lei_id) ON DELETE CASCADE,
    UNIQUE (user_id, versao_lei_id, tipo_notificacao)
);
```

### 9. Assinaturas

`subscription_status` é um campo de status nomeado, seguindo o padrão fixado
em `./ADR-005-status-fields.md`: descreve o ciclo de vida da
assinatura paga, um conceito que não existe em `legal_status`,
`publication_status`, `device_status` nem `update_review_status` — por isso
recebe seu próprio nome e enum. O gateway e a oferta do MVP são fixados em
`./ADR-008-monetizacao-e-gateway.md`.

```sql
CREATE TABLE assinaturas (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plano                    text NOT NULL DEFAULT 'premium'
        CHECK (plano = 'premium'),
    periodicidade            text
        CHECK (periodicidade IN ('mensal', 'anual')),
    meio_pagamento           text
        CHECK (meio_pagamento IN ('cartao', 'pix')),
    subscription_status      text NOT NULL DEFAULT 'trialing'
        CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
    provedor_pagamento       text NOT NULL DEFAULT 'asaas'
        CHECK (provedor_pagamento = 'asaas'),
    id_cliente_provedor      text,
    id_assinatura_provedor   text,                 -- id externo da assinatura no provedor de pagamento
    data_inicio              timestamptz NOT NULL DEFAULT now(),
    data_fim_trial           timestamptz,
    data_proxima_renovacao   timestamptz,
    data_cancelamento        timestamptz,
    ultimo_evento_provedor_em timestamptz,
    criado_em                timestamptz NOT NULL DEFAULT now(),
    atualizado_em            timestamptz NOT NULL DEFAULT now(),
    CHECK (
        subscription_status <> 'trialing'
        OR data_fim_trial IS NOT NULL
    ),
    CHECK (
        subscription_status NOT IN ('active', 'past_due')
        OR (
            periodicidade IS NOT NULL
            AND meio_pagamento IS NOT NULL
            AND id_cliente_provedor IS NOT NULL
            AND id_assinatura_provedor IS NOT NULL
        )
    )
);

-- Um usuário só pode ter uma assinatura "em curso" por vez (trialing, active
-- ou past_due); assinaturas canceladas/expiradas permanecem como histórico.
CREATE UNIQUE INDEX assinaturas_em_curso_unica
    ON assinaturas (user_id)
    WHERE subscription_status IN ('trialing', 'active', 'past_due');

CREATE UNIQUE INDEX assinaturas_trial_unico
    ON assinaturas (user_id)
    WHERE data_fim_trial IS NOT NULL;

-- Inbox append-only de eventos financeiros. O handler reserva a chave antes
-- de enfileirar; não armazena payload integral nem segredo do webhook.
CREATE TABLE eventos_gateway_pagamento (
    id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assinatura_id                   uuid REFERENCES assinaturas(id) ON DELETE SET NULL,
    provedor                        text NOT NULL CHECK (provedor = 'asaas'),
    evento_id                       text NOT NULL,
    tipo_evento                     text NOT NULL,
    tipo_recurso                    text NOT NULL
        CHECK (tipo_recurso IN ('payment', 'subscription')),
    recurso_id                      text NOT NULL,
    id_assinatura_provedor          text,
    ocorrido_em                     timestamptz NOT NULL,
    recebido_em                     timestamptz NOT NULL DEFAULT now(),
    processado_em                   timestamptz,
    payment_event_processing_status text NOT NULL DEFAULT 'pending'
        CHECK (payment_event_processing_status IN (
            'pending', 'applied', 'ignored', 'failed'
        )),
    payload_sha256                  text NOT NULL
        CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    codigo_erro                     text,
    mensagem_erro                  text,
    UNIQUE (provedor, evento_id)
);
```

Uma conta verificada recebe no máximo uma linha de trial em sua vida; essa
garantia é reforçada por `assinaturas_trial_unico`, não apenas pelo índice de
assinatura em curso. Eventos são processados em fila e reconciliados com a API
do Asaas. Transições antigas são ignoradas comparando `ocorrido_em` com
`ultimo_evento_provedor_em`. Limites de 20 favoritos e 5 notas no gratuito
são verificados sob lock pela mesma função transacional que grava o recurso;
o cliente nunca decide entitlement.

### 10. Auditoria administrativa do SaaS

Elevação de papel, suspensão/reativação de conta e solicitações de suporte ao
provedor geram eventos append-only. Metadados usam allowlist e não armazenam
tokens, payload integral do gateway ou conteúdo pessoal livre.

```sql
CREATE TABLE auditoria_admin (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ator_user_id    uuid NOT NULL REFERENCES auth.users(id),
    alvo_user_id    uuid REFERENCES auth.users(id),
    acao            text NOT NULL
        CHECK (acao IN (
            'role_changed','account_suspended','account_reactivated',
            'provider_cancel_requested','provider_refund_requested'
        )),
    justificativa   text NOT NULL,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    criado_em       timestamptz NOT NULL DEFAULT now()
);
```

---

## Row Level Security

| Tabela | Leitura | Escrita |
|---|---|---|
| `leis` | `anon`/`authenticated` recebem somente colunas públicas e linhas `published`, preferencialmente via `api.leis_publicadas` | Somente função privada chamada pela role do publicador |
| `versoes_lei` | Somente projeção pública de changelog, sem fonte, aprovador, hashes internos ou URIs | Somente função privada do publicador |
| `artefatos_fonte` | Sem grant público; URLs, hashes e URIs integram a trilha interna de auditoria | Somente função privada do publicador |
| `dispositivos` | Somente colunas de leitura da versão indicada por `leis.versao_publicada_id`; referências de fonte e `parse_evidence` não têm grant público | Somente função privada do publicador |
| `block_ids` | Sem grant para clientes; leitura por serviços internos | Somente função privada do publicador |
| `block_id_redirects` | Sem grant direto; acessada apenas pelo resolvedor oficial | Somente função privada do publicador |
| `updates_legislativos` | Sem acesso direto pela Data API; editor usa endpoints/RPCs autenticados e o worker usa função restrita de inserção | Funções distintas para worker e decisão editorial; nunca escrita normativa |
| `publicacoes` | Sem acesso direto pela Data API; estado consultado por endpoint editorial autenticado | Somente Serviço de Publicação |
| `usuarios_perfil` | Próprio perfil; listagem administrativa somente por endpoint privado | Usuário altera apenas campos permitidos de preferência; `papel` e `account_status` somente por função administrativa auditada |
| `favoritos` | Restrita ao próprio `user_id` (`auth.uid() = user_id`) | Restrita ao próprio `user_id` |
| `colecoes` | Restrita ao próprio `user_id` (`auth.uid() = user_id`) | Restrita ao próprio `user_id` |
| `favoritos_colecao` | Restrita a favoritos/coleções cujo dono é `auth.uid()` (via `EXISTS`, tabela não tem `user_id` próprio) | Idem |
| `notas` | Restrita ao próprio `user_id` (`auth.uid() = user_id`) | Restrita ao próprio `user_id` |
| `marcacoes` | Restrita ao próprio `user_id` (`auth.uid() = user_id`) | Restrita ao próprio `user_id` |
| `eventos_leitura` | Restrita ao próprio `user_id` (`auth.uid() = user_id`) | Inserção restrita ao próprio `user_id`; sem `UPDATE`/`DELETE` pelo usuário (log imutável) |
| `progresso_leitura` | Restrita ao próprio `user_id` (`auth.uid() = user_id`) | Somente trigger/função privada de manutenção; usuário não edita diretamente |
| `trilhas_estudo` | Pública quando `publica = true`; quando `publica = false`, restrita a `auth.uid() = criado_por` | Trilhas públicas: função privada exige `papel IN ('curador','administrador')` e conta ativa; trilhas privadas: próprio `criado_por` com entitlement Premium |
| `trilha_itens` | Segue a visibilidade da trilha pai (`trilhas_estudo.publica` ou `criado_por`) | Idem |
| `trilhas_usuario` | Restrita ao próprio `user_id` | Restrita ao próprio `user_id`; só pode adotar trilha pública ou trilha privada própria |
| `notificacoes` | Restrita ao próprio `user_id` | Inserção somente pela função privada de fan-out; usuário pode atualizar apenas `lida_em` das próprias linhas |
| `assinaturas` | Restrita ao próprio `user_id` (`auth.uid() = user_id`) | Função privada invocada pela identidade dedicada do webhook; usuário não escreve diretamente |
| `eventos_gateway_pagamento` | Somente worker financeiro e endpoint administrativo privado | Append-only pelo endpoint de webhook; transição de processamento somente pelo worker financeiro |
| `auditoria_admin` | Somente endpoint administrativo privado | Append-only pelas funções administrativas; sem `UPDATE`/`DELETE` |

Baseline conceitual para conteúdo normativo:

```sql
ALTER TABLE leis ENABLE ROW LEVEL SECURITY;
ALTER TABLE versoes_lei ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispositivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leitura publica de leis publicadas"
    ON leis FOR SELECT
    USING (publication_status = 'published');

CREATE POLICY "changelog de lei publicada"
    ON versoes_lei FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM leis
            WHERE leis.id = versoes_lei.lei_id
              AND leis.publication_status = 'published'
        )
    );

CREATE POLICY "somente dispositivos da versão pública"
    ON dispositivos FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM leis
            WHERE leis.id = dispositivos.lei_id
              AND leis.publication_status = 'published'
              AND leis.versao_publicada_id = dispositivos.versao_lei_id
        )
    );

-- Nenhum papel cliente recebe escrita; grants e RLS são camadas distintas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON leis, versoes_lei, dispositivos
    FROM anon, authenticated;

-- Colunas editoriais não são alcançáveis mesmo em uma linha publicada.
REVOKE ALL ON versoes_lei, dispositivos FROM anon, authenticated;
GRANT SELECT (
    id, sigla, titulo, tipo, numero, ano, ramo, data_publicacao,
    versao_publicada_id, legal_status, publication_status
) ON leis TO anon, authenticated;

GRANT SELECT (
    id, lei_id, numero_publicacao, versao_vinculex, tipo_publicacao,
    restaura_versao_id, data_atualizacao_legal, data_formatacao_vinculex,
    changelog, mudancas, publicado_em
) ON versoes_lei TO anon, authenticated;

GRANT SELECT (
    id, versao_lei_id, lei_id, parent_id, tipo, block_id, numero, titulo,
    texto, conteudo_estruturado, ordem, device_status, nota_status,
    preservar_texto_revogado, redacao_atual_dada_por,
    redacoes_anteriores, renumerado_para_block_id
) ON dispositivos TO anon, authenticated;

-- Views `api.*` usam security_invoker, projeção explícita e as mesmas RLS/
-- column grants das tabelas base. Nunca usam SELECT *.
```

O schema exposto pela Data API contém somente contratos públicos versionados:

- `api.leis_publicadas`;
- `api.dispositivos_publicados`;
- `api.changelog_publico`;
- `api.resolver_block_id(lei_id, block_id)`, que percorre aliases no servidor,
  limita saltos, detecta ciclos e retorna ID solicitado, ID canônico e conjunto
  equivalente de origens;
- `api.buscar_dispositivos(query, ramo, lei_id, limite, cursor)`, sempre
  restrito ao snapshot indicado pelo ponteiro público.

As tabelas `block_id_redirects`, editoriais e funções privilegiadas ficam fora
dos schemas expostos. Views e busca usam `security_invoker`. O resolvedor é a
exceção deliberada: uma função `SECURITY DEFINER` de retorno estritamente
tipado, `search_path = ''`, nomes totalmente qualificados, limite de saltos e
sem SQL dinâmico; `EXECUTE` é concedido apenas aos papéis públicos que precisam
resolver IDs. As demais funções privilegiadas revogam `EXECUTE` de
`PUBLIC`, `anon` e `authenticated`.

Política conceitual de exemplo (dados de usuário protegidos por `user_id`):

```sql
ALTER TABLE favoritos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario le seus proprios favoritos"
    ON favoritos FOR SELECT
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );

CREATE POLICY "usuario insere seus proprios favoritos"
    ON favoritos FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );

CREATE POLICY "usuario atualiza seus proprios favoritos"
    ON favoritos FOR UPDATE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    )
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );

CREATE POLICY "usuario exclui seus proprios favoritos"
    ON favoritos FOR DELETE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );
```

Política conceitual de exemplo (`notas` — mesmo padrão `auth.uid() = user_id`,
aplicado a uma tabela de conteúdo livre em vez de uma relação simples):

```sql
ALTER TABLE notas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario le suas proprias notas"
    ON notas FOR SELECT
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );

CREATE POLICY "usuario insere suas proprias notas"
    ON notas FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );

CREATE POLICY "usuario atualiza suas proprias notas"
    ON notas FOR UPDATE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    )
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );

CREATE POLICY "usuario exclui suas proprias notas"
    ON notas FOR DELETE
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );
```

Os exemplos de política de linha não concedem automaticamente todas as
colunas. Em `favoritos`, `notas`, `marcacoes` e `eventos_leitura`, grants de
coluna impedem o cliente de fornecer `user_id` e
`versao_lei_id_criacao`. Trigger/função de mutação deriva `user_id` de
`auth.uid()`, lê `leis.versao_publicada_id`, valida a relação
`(lei_id, block_id)` e grava o ID canônico quando o evento representa leitura.
Criação de favorito e nota passa obrigatoriamente por funções transacionais
que também aplicam os entitlements da ADR-008 sob lock; grants diretos não
permitem contornar as cotas. Atualizações de nota existente permitem apenas
conteúdo/título mesmo acima da cota, pois não aumentam a contagem; novas notas
ficam bloqueadas e remoções continuam permitidas. A versão de criação é
imutável. Em `notificacoes`, o
cliente só pode atualizar `lida_em`.
Todas as políticas autenticadas de dados pessoais repetem (ou encapsulam em
função segura e testada) a condição `account_status = 'active'`; middleware
sozinho não é fronteira de autorização. A exceção é a projeção mínima do
próprio perfil necessária para informar que a conta está suspensa.

Política conceitual de exemplo (`assinaturas` — leitura pelo próprio usuário,
mas escrita removida dos papéis clientes porque o estado real é ditado pelo
webhook do provedor de pagamento):

```sql
ALTER TABLE assinaturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario le sua propria assinatura"
    ON assinaturas FOR SELECT
    USING (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM usuarios_perfil p
            WHERE p.user_id = auth.uid()
              AND p.account_status = 'active'
        )
    );

REVOKE INSERT, UPDATE, DELETE ON assinaturas FROM anon, authenticated;

-- O webhook chama uma função fora dos schemas expostos, com EXECUTE concedido
-- apenas à role dedicada. A função fixa search_path = '', valida o evento
-- assinado e referencia objetos por nomes qualificados.
```

Nenhuma política concede escrita de conteúdo normativo (`leis`,
`versoes_lei`, `dispositivos`, `block_ids`) a usuários do SaaS, ao worker ou
à estação do Lex Editor. Toda escrita normativa passa pela função privada e
transacional chamada exclusivamente pela identidade de menor privilégio do
Serviço de Publicação; a aprovação nasce no fluxo editorial, mas sua
autoridade é revalidada no servidor conforme o ADR-007.

---

## Estratégia de versionamento de dados

- **Uma lei tem N versões, uma versão tem N dispositivos.** Cada publicação
  concluída cria uma nova linha em `versoes_lei`, com SemVer inédito,
  `numero_publicacao` monotônico e um conjunto completo de linhas em
  `dispositivos`, mesmo que apenas um artigo tenha mudado. A versão servida é
  sempre a indicada por `leis.versao_publicada_id`; inferi-la por `MAX`,
  timestamp ou ordenação lexicográfica de SemVer é proibido.
- **Block IDs são a chave de estabilidade entre versões.** A tabela `block_ids` é um registro append-only que armazena, sem `^`, todo Block ID já emitido e a versão em que foi criado pela primeira vez (`primeira_versao_id`). Ao gerar uma nova versão, o Lex Editor reconcilia a NormaAST candidata com a última versão publicada e reutiliza o Block ID existente para o mesmo dispositivo jurídico. Um dispositivo novo (ex.: artigo incluído por lei posterior, como "121-A") recebe um Block ID novo, registrado nesse momento.
- **A árvore atual não renomeia o passado.** Se um dispositivo novo colidir com um ID simples já publicado, o ID antigo permanece intacto e somente o novo recebe a menor qualificação estrutural livre. IDs revogados, renumerados e depreciados continuam reservados.
- **Aliases são permanentes.** `block_id_redirects` materializa correções e
  renumerações excepcionais. A resolução consulta primeiro o ID na versão
  pública atual e, quando ausente, segue o redirecionamento até o destino
  canônico. Ciclos e destinos inexistentes bloqueiam a publicação.
- **Mudança de texto não gera novo Block ID.** Se o caput do art. 121 é alterado por lei posterior, a nova versão de `dispositivos` cria uma nova linha com o mesmo `block_id`, texto atualizado e, se aplicável, `device_status = 'amended'` com `nota_status` explicando a origem da alteração. Notas e favoritos do usuário, vinculados ao `block_id`, continuam válidos automaticamente.
- **Revogação e veto não removem o dispositivo.** Um dispositivo revogado ou vetado permanece na árvore com `device_status` correspondente (`revoked` ou `vetoed`) e `nota_status` explicativa, em todas as versões subsequentes onde ainda é referenciado estruturalmente — nunca é deletado, preservando a possibilidade de consulta histórica ("o que dizia o art. X antes de ser revogado").
- **Rastreabilidade Git ↔ Supabase.** Todo registro em `versoes_lei` carrega `git_commit_sha`, permitindo, a qualquer momento, abrir o commit exato do Git que originou aquela versão publicada — a via de auditoria definitiva quando o dado estruturado no Postgres precisar ser conferido contra o Markdown fonte.
- **Idempotência.** `publicacoes.idempotency_key` identifica a operação lógica
  de ponta a ponta. Retentativas atualizam a mesma publicação e verificam
  `conteudo_sha256`/`git_commit_sha`; divergência para a mesma chave é erro
  bloqueante.
- **Reversão (rollback).** Reverter uma publicação significa restaurar um
  snapshot anterior como nova publicação, com novo commit, SemVer e
  `numero_publicacao`, ligado por `restaura_versao_id`. O histórico nunca é
  reescrito e o Supabase nunca é apontado diretamente para uma versão antiga
  sem o correspondente release commit novo.
